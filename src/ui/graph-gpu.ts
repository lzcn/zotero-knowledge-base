import type { LayoutNode } from "./graph-layout";
import type { CanvasEdge, GraphView } from "./graph-canvas";

const COMMON = `
precision highp float;
uniform vec2 viewport;
uniform vec3 view;
vec2 clip(vec2 p) {
  return vec2(p.x / viewport.x * 2.0 - 1.0, 1.0 - p.y / viewport.y * 2.0);
}
`;
const EDGE_VERTEX = `#version 300 es
${COMMON}
layout(location=0) in vec3 source;
layout(location=1) in vec3 target;
layout(location=2) in vec3 meta;
layout(location=3) in vec4 color;
out vec4 ink;
out float side;
out float distanceAlong;
flat out float dashed;
vec2 curve(float t, vec2 a, vec2 b, vec2 c, vec2 d) {
  float u = 1.0 - t;
  return u*u*u*a + 3.0*u*u*t*b + 3.0*u*t*t*c + t*t*t*d;
}
void main() {
  vec2 delta = target.xy - source.xy;
  float len = length(delta);
  vec2 dir = delta / max(len, 0.001);
  vec2 a, b, c, d;
  if (len < 1.0) {
    a = source.xy + vec2(10.0, -6.0);
    b = source.xy + vec2(54.0, -60.0);
    c = source.xy + vec2(-54.0, -60.0);
    d = source.xy + vec2(-10.0, -6.0);
  } else {
    a = source.xy + dir * min(max(source.z, 3.5 / view.z) + 2.0, len / 3.0);
    d = target.xy - dir * min(max(target.z, 3.5 / view.z) + 2.0, len / 3.0);
    if (meta.y < 0.5) {
      float mid = (a.y + d.y) * 0.5;
      b = vec2(a.x, mid);
      c = vec2(d.x, mid);
    } else {
      vec2 q = (a + d) * 0.5 + vec2(-dir.y, dir.x) * min(80.0, len * 0.16);
      b = a + (q - a) * (2.0 / 3.0);
      c = d + (q - d) * (2.0 / 3.0);
    }
  }
  int vertex = gl_VertexID;
  vec2 p;
  side = 0.0;
  distanceAlong = 0.0;
  dashed = meta.y > 1.5 ? 1.0 : 0.0;
  if (vertex >= 120) {
    vec2 end = d * view.z + view.xy;
    vec2 tangent = normalize(d - curve(0.99, a, b, c, d) + vec2(0.00001));
    vec2 normal = vec2(-tangent.y, tangent.x);
    p = vertex == 120 ? end : end - tangent * 5.0 + normal * (vertex == 121 ? 2.5 : -2.5);
    if (dashed > 0.5) p = end;
  } else {
    int corner = vertex % 6;
    float t = (float(vertex / 6) + (corner == 1 || corner == 2 || corner == 4 ? 1.0 : 0.0)) / 20.0;
    vec2 tangent = normalize(curve(min(1.0, t + 0.001), a, b, c, d) - curve(max(0.0, t - 0.001), a, b, c, d) + vec2(0.00001));
    vec2 normal = vec2(-tangent.y, tangent.x);
    side = corner == 0 || corner == 1 || corner == 3 ? -1.0 : 1.0;
    p = curve(t, a, b, c, d) * view.z + view.xy + normal * side * (meta.x * 0.5 + 0.75);
    distanceAlong = t * max(len, 120.0) * view.z;
  }
  ink = color;
  gl_Position = vec4(clip(p), 0.0, 1.0);
}
`;
const EDGE_FRAGMENT = `#version 300 es
precision highp float;
in vec4 ink;
in float side;
in float distanceAlong;
flat in float dashed;
out vec4 outputColor;
void main() {
  if (dashed > 0.5 && mod(distanceAlong, 9.0) > 5.0) discard;
  float coverage = 1.0 - smoothstep(0.5, 1.0, abs(side));
  outputColor = vec4(ink.rgb, ink.a * coverage);
}
`;
const NODE_VERTEX = `#version 300 es
${COMMON}
layout(location=0) in vec3 center;
layout(location=1) in vec4 color;
layout(location=2) in vec2 flags;
out vec2 point;
out vec4 ink;
flat out float radius;
flat out vec2 state;
void main() {
  vec2 corners[6] = vec2[6](vec2(-1,-1),vec2(1,-1),vec2(1,1),vec2(-1,-1),vec2(1,1),vec2(-1,1));
  radius = max(center.z * view.z, 3.5);
  point = corners[gl_VertexID] * (radius + (flags.y > 0.5 ? 6.0 : 1.0));
  state = flags;
  ink = color;
  gl_Position = vec4(clip(center.xy * view.z + view.xy + point), 0.0, 1.0);
}
`;
const NODE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 background;
uniform vec4 accent;
uniform vec4 muted;
in vec2 point;
in vec4 ink;
flat in float radius;
flat in vec2 state;
out vec4 outputColor;
void main() {
  float r = length(point);
  float disc = 1.0 - smoothstep(radius - 0.5, radius + 0.5, r);
  float border = smoothstep(radius - 2.0, radius - 1.0, r);
  vec4 edge = state.x > 0.5 ? muted : background;
  if (state.x > 0.5 && mod(atan(point.y, point.x) * radius + 1000.0, 5.0) > 3.0) edge = background;
  vec4 fill = mix(ink, edge, border);
  float ring = state.y > 0.5 ? 1.0 - smoothstep(0.5, 1.5, abs(r - radius - 4.0)) : 0.0;
  outputColor = vec4(mix(fill.rgb, accent.rgb, ring), max(disc * fill.a, ring));
}
`;

/** Two instanced draws replace thousands of CPU-rasterized paths per frame. */
export function createGraphGPU(
  canvas: HTMLCanvasElement,
  style: CSSStyleDeclaration,
) {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: true,
    failIfMajorPerformanceCaveat: true,
  });
  if (!gl) return;
  const palette = new Map<string, number[]>();
  const rgb = (value: string): number[] => {
    if (palette.has(value)) return palette.get(value)!;
    const hex = value.trim().replace(/^#/, "");
    const expanded =
      hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    const channels = /^[\da-f]{6}$/i.test(expanded)
      ? [0, 2, 4].map(
          (offset) => parseInt(expanded.slice(offset, offset + 2), 16) / 255,
        )
      : (value.match(/[\d.]+/g) || []).slice(0, 3).map((c) => Number(c) / 255);
    const result =
      channels.length === 3 && channels.every(Number.isFinite)
        ? [...channels, 1]
        : [0.14, 0.41, 0.79, 1];
    palette.set(value, result);
    return result;
  };
  const color = (name: string) => rgb(style.getPropertyValue(name).trim());
  const background = color("--bg"),
    accent = color("--accent"),
    muted = color("--muted"),
    sourceColor = color("--source"),
    linkColor = color("--graph-link");
  function program(
    vertex: string,
    fragment: string,
    stride: number,
    attributes: number[],
  ) {
    const result = gl!.createProgram()!;
    const shaders: WebGLShader[] = [];
    try {
      for (const [type, text] of [
        [gl!.VERTEX_SHADER, vertex],
        [gl!.FRAGMENT_SHADER, fragment],
      ] as const) {
        const shader = gl!.createShader(type)!;
        shaders.push(shader);
        gl!.shaderSource(shader, text);
        gl!.compileShader(shader);
        if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS))
          throw new Error(
            gl!.getShaderInfoLog(shader) || "Graph shader compilation failed",
          );
        gl!.attachShader(result, shader);
      }
      gl!.linkProgram(result);
      if (!gl!.getProgramParameter(result, gl!.LINK_STATUS))
        throw new Error(
          gl!.getProgramInfoLog(result) || "Graph shader linking failed",
        );
    } catch (error) {
      gl!.deleteProgram(result);
      throw error;
    } finally {
      for (const shader of shaders) gl!.deleteShader(shader);
    }
    const buffer = gl!.createBuffer()!,
      array = gl!.createVertexArray()!;
    gl!.bindVertexArray(array);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
    let offset = 0;
    attributes.forEach((size, index) => {
      gl!.enableVertexAttribArray(index);
      gl!.vertexAttribPointer(
        index,
        size,
        gl!.FLOAT,
        false,
        stride * 4,
        offset * 4,
      );
      gl!.vertexAttribDivisor(index, 1);
      offset += size;
    });
    const uniforms = new Map(
      ["viewport", "view", "background", "accent", "muted"].map((name) => [
        name,
        gl!.getUniformLocation(result, name),
      ]),
    );
    let capacity = 0;
    return {
      use(
        values: Float32Array,
        count: number,
        vertices: number,
        width: number,
        height: number,
        view: GraphView,
      ) {
        if (!count) return;
        gl!.useProgram(result);
        gl!.bindVertexArray(array);
        gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
        if (values.byteLength > capacity) {
          capacity = values.byteLength;
          gl!.bufferData(gl!.ARRAY_BUFFER, capacity, gl!.DYNAMIC_DRAW);
        }
        gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, values, 0, count * stride);
        gl!.uniform2f(uniforms.get("viewport")!, width, height);
        gl!.uniform3f(uniforms.get("view")!, view.x, view.y, view.k);
        gl!.uniform4fv(uniforms.get("background")!, background);
        gl!.uniform4fv(uniforms.get("accent")!, accent);
        gl!.uniform4fv(uniforms.get("muted")!, muted);
        gl!.drawArraysInstanced(gl!.TRIANGLES, 0, vertices, count);
      },
      dispose() {
        gl!.deleteVertexArray(array);
        gl!.deleteBuffer(buffer);
        gl!.deleteProgram(result);
      },
    };
  }
  function initialize() {
    const edgeProgram = program(EDGE_VERTEX, EDGE_FRAGMENT, 13, [3, 3, 3, 4]);
    try {
      return {
        edges: edgeProgram,
        nodes: program(NODE_VERTEX, NODE_FRAGMENT, 9, [3, 4, 2]),
      };
    } catch (error) {
      edgeProgram.dispose();
      throw error;
    }
  }
  let lost = gl.isContextLost(),
    disposed = false;
  let programs: ReturnType<typeof initialize> | undefined = lost
    ? undefined
    : initialize();
  let nodeValues = new Float32Array(0),
    edgeValues = new Float32Array(0);
  const lose = (event: Event) => {
    event.preventDefault();
    lost = true;
  };
  const restore = () => {
    if (disposed) return;
    try {
      programs = initialize();
      lost = false;
    } catch (error) {
      Zotero.logError(error as Error);
    }
  };
  canvas.addEventListener("webglcontextlost", lose);
  canvas.addEventListener("webglcontextrestored", restore);
  return {
    get available() {
      return !!programs && !disposed && !lost && !gl.isContextLost();
    },
    draw(
      nodes: LayoutNode[],
      edges: CanvasEdge[],
      view: GraphView,
      width: number,
      height: number,
      focus?: string,
      selected?: string,
      matched = new Set<string>(),
    ) {
      if (!this.available) return false;
      const ratio = canvas.ownerDocument.defaultView!.devicePixelRatio || 1;
      const w = Math.round(width * ratio),
        h = Math.round(height * ratio);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (nodeValues.length < nodes.length * 9)
        nodeValues = new Float32Array(nodes.length * 9);
      if (edgeValues.length < edges.length * 13)
        edgeValues = new Float32Array(edges.length * 13);
      let index = 0;
      // Keep background relations at their original intensity and paint incident links last.
      for (const active of [false, true])
        for (const edge of edges) {
          const highlighted = focus
            ? edge.source.id === focus || edge.target.id === focus
            : matched.has(edge.source.id) || matched.has(edge.target.id);
          if (highlighted !== active) continue;
          const kind =
            edge.kind === "parent" ? 0 : edge.kind === "source" ? 2 : 1;
          const ink = active ? (kind === 2 ? sourceColor : accent) : linkColor;
          edgeValues.set(
            [
              edge.source.x,
              edge.source.y,
              edge.source.radius,
              edge.target.x,
              edge.target.y,
              edge.target.radius,
              active ? 2.4 : kind === 0 ? 1.2 : 1.1,
              kind,
              0,
              ...ink.slice(0, 3),
              active ? 1 : 0.65,
            ],
            index++ * 13,
          );
        }
      nodes.forEach((node, i) => {
        const ink =
          node.kind === "source"
            ? sourceColor
            : node.kind === "unresolved"
              ? background
              : rgb(node.color || style.getPropertyValue("--accent"));
        nodeValues.set(
          [
            node.x,
            node.y,
            node.radius,
            ...ink,
            node.kind === "unresolved" ? 1 : 0,
            node.id === focus || node.id === selected ? 1 : 0,
          ],
          i * 9,
        );
      });
      programs!.edges.use(edgeValues, edges.length, 123, width, height, view);
      programs!.nodes.use(nodeValues, nodes.length, 6, width, height, view);
      gl.bindVertexArray(null);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener("webglcontextlost", lose);
      canvas.removeEventListener("webglcontextrestored", restore);
      programs?.edges.dispose();
      programs?.nodes.dispose();
      programs = undefined;
      nodeValues = edgeValues = new Float32Array(0);
    },
  };
}
