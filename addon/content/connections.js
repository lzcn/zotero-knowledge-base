/* global Zotero */
"use strict";

window.KnowledgeBaseConnections = {
  /** @param {{button: HTMLButtonElement, panel: HTMLElement, api: import("../../src/modules/api").KnowledgeBaseAPI, available(): boolean, prepare(): Promise<{id: string, token: string}>, isCurrent(token: string): boolean, apply(plan: import("../../src/modules/connections").ConnectionPlan, selection: {parent: boolean, links: {id: string}[]}, token: string): Promise<void>}} options */
  create(options) {
    const { button, panel, api } = options;
    let disposed = false;
    let job = null;
    let applying = false;
    let generation = 0;
    /** @template {keyof HTMLElementTagNameMap} T @param {T} name @param {string} text @returns {HTMLElementTagNameMap[T]} */
    const element = (name, text = "") => {
      const node = /** @type {HTMLElementTagNameMap[T]} */ (
        document.createElementNS("http://www.w3.org/1999/xhtml", name)
      );
      node.textContent = text;
      return node;
    };
    const status = element("p");
    status.setAttribute("role", "status");
    const results = element("div");
    const actions = element("div");
    actions.className = "connection-actions";
    const apply = element("button", api.loc("ai-apply"));
    const cancel = element("button", api.loc("ai-close"));
    actions.append(apply, cancel);
    panel.replaceChildren(status, results, actions);
    panel.setAttribute("aria-label", api.loc("ai-connect"));
    button.textContent = api.loc("ai-connect");
    const close = () => {
      generation++;
      if (job) api.cancelAIJob(job);
      job = null;
      button.disabled = false;
      cancel.disabled = false;
      panel.setAttribute("aria-busy", "false");
      panel.hidden = true;
      results.replaceChildren();
      apply.onclick = null;
    };
    cancel.addEventListener("click", close);
    button.addEventListener("click", async () => {
      if (
        job ||
        disposed ||
        applying ||
        !api.isAIEnabled() ||
        !options.available()
      )
        return;
      close();
      const version = generation;
      const valid = () =>
        !disposed && generation === version && api.isAIEnabled();
      button.disabled = true;
      panel.hidden = false;
      apply.hidden = true;
      cancel.textContent = api.loc("ai-cancel");
      status.textContent = api.loc("ai-preparing");
      try {
        const prepared = await options.prepare();
        if (!valid()) return;
        job = `connections-${Date.now()}-${Math.random()}`;
        const plan = await api.establishConnections(
          prepared.id,
          job,
          (stage, count, total) => {
            if (valid())
              status.textContent = api.loc(`ai-progress-${stage}`, {
                count,
                total,
              });
          },
        );
        if (!valid()) return;
        if (!options.isCurrent(prepared.token))
          throw new Error(api.loc("ai-plan-stale"));
        const targets = new Map(plan.targets.map((note) => [note.id, note]));
        const selections = [];
        const showEvidence = (container, suggestion) => {
          const pair = element("div");
          pair.className = "connection-evidence";
          for (const [label, quote] of [
            ["ai-evidence-current", suggestion.currentEvidence],
            ["ai-evidence-target", suggestion.targetEvidence],
          ]) {
            const passage = element("div");
            passage.append(element("strong", api.loc(label)));
            const excerpt = element("blockquote");
            const anchor =
              label === "ai-evidence-current" ? suggestion.anchor : "";
            const start = anchor ? quote.indexOf(anchor) : -1;
            if (start >= 0)
              excerpt.append(
                document.createTextNode(quote.slice(0, start)),
                element("mark", anchor),
                document.createTextNode(quote.slice(start + anchor.length)),
              );
            else excerpt.textContent = quote;
            passage.append(excerpt);
            pair.append(passage);
          }
          container.append(pair);
        };
        const check = (container, label, noteID = null) => {
          const wrapper = element("label");
          const input = element("input");
          input.type = "checkbox";
          const title = element(noteID ? "button" : "span", label);
          if (noteID) {
            title.className = "relation-link";
            title.addEventListener("click", (event) => {
              event.preventDefault();
              api.openEditor({ zettelId: noteID, window: true });
            });
          }
          wrapper.append(input, title);
          container.append(wrapper);
          return input;
        };
        let parent = null;
        if (plan.parent) {
          const section = element("div");
          section.className = "connection-suggestion";
          section.append(element("strong", api.loc("ai-parent")));
          const target = targets.get(plan.parent.id);
          parent = check(
            section,
            `${target.title} (${target.reference})`,
            target.id,
          );
          section.append(element("p", plan.parent.reason));
          section.append(
            element(
              "p",
              api.loc("ai-parent-from", {
                parent: plan.previousParent
                  ? `${plan.previousParent.title} (${plan.previousParent.reference})`
                  : api.loc("ai-parent-none"),
              }),
            ),
          );
          if (plan.parent.path.length > 1)
            section.append(element("p", plan.parent.path.join(" / ")));
          showEvidence(section, plan.parent);
          results.append(section);
        }
        for (const link of plan.links) {
          const section = element("div");
          section.className = "connection-suggestion";
          const target = targets.get(link.id);
          section.append(
            element("strong", api.loc(`ai-relation-${link.relation}`)),
          );
          const reference = check(
            section,
            `${target.title} (${target.reference})`,
            target.id,
          );
          section.append(element("p", link.reason));
          showEvidence(section, link);
          section.append(
            element("p", api.loc("ai-link-preview", { anchor: link.anchor })),
          );
          selections.push({ id: link.id, reference });
          results.append(section);
        }
        status.textContent = api.loc(
          plan.parent || plan.links.length ? "ai-review" : "ai-no-connections",
          {
            parents: plan.parent ? 1 : 0,
            links: plan.links.length,
            read: plan.read.length,
          },
        );
        apply.hidden = !plan.parent && !plan.links.length;
        apply.disabled = true;
        const update = () => {
          apply.disabled =
            !parent?.checked &&
            !selections.some((row) => row.reference.checked);
        };
        results.onchange = update;
        apply.onclick = async () => {
          if (!valid() || apply.disabled || applying) return;
          applying = true;
          button.disabled = true;
          apply.disabled = true;
          cancel.disabled = true;
          panel.setAttribute("aria-busy", "true");
          for (const input of results.querySelectorAll("input")) {
            /** @type {HTMLInputElement} */ (input).disabled = true;
          }
          try {
            if (!options.isCurrent(prepared.token))
              throw new Error(api.loc("ai-plan-stale"));
            await options.apply(
              plan,
              {
                parent: !!parent?.checked,
                links: selections
                  .filter((row) => row.reference.checked)
                  .map((row) => ({
                    id: row.id,
                  })),
              },
              prepared.token,
            );
            if (!valid()) return;
            results.replaceChildren();
            apply.hidden = true;
            status.textContent = api.loc("ai-applied");
          } catch (error) {
            Zotero.logError(error);
            if (valid())
              status.textContent =
                error.message === "AI_PLAN_STALE"
                  ? api.loc("ai-plan-stale")
                  : String(error.message || error);
          } finally {
            applying = false;
            if (valid()) {
              cancel.disabled = false;
              button.disabled = false;
              panel.setAttribute("aria-busy", "false");
              for (const input of results.querySelectorAll("input")) {
                /** @type {HTMLInputElement} */ (input).disabled = false;
              }
              if (!apply.hidden) update();
            }
          }
        };
      } catch (error) {
        if (valid()) status.textContent = String(error.message || error);
      } finally {
        if (valid()) {
          job = null;
          button.disabled = false;
          cancel.textContent = api.loc("ai-close");
        }
      }
    });
    const refresh = () => {
      const available = api.isAIEnabled() && options.available();
      button.hidden = !available;
      if (!available) close();
    };
    const unsubscribe = api.onAIEnabledChange(refresh);
    refresh();
    return {
      refresh,
      destroy() {
        disposed = true;
        unsubscribe();
        close();
      },
    };
  },
};
