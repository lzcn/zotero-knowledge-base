var SW_CSS = `
@import url("chrome://similar-works/content/ui.css");
/* Constrain result text without changing Zotero's native sidebar geometry. */
.sw-list { contain: inline-size; min-width: 0; display: flex; flex-direction: column; padding: 4px 0; font: 13px/1.4 var(--ui-font); color: var(--ui-fg); }
.sw-computation-progress { display: block; width: calc(100% - 16px); height: 4px; margin: 4px 8px 8px; accent-color: var(--ui-accent); }
.sw-computation-progress[hidden], .sw-source[hidden], .sw-evidence[hidden] { display: none; }
.sw-status { padding: 6px 8px; color: var(--ui-muted); font-size: 12px; }
.sw-row { position: relative; display: flex; align-items: flex-start; gap: 8px; padding: 9px 8px; border: 0; border-radius: 0; background: transparent; text-align: start; font: inherit; color: inherit; width: 100%; cursor: pointer; }
/* Native button height limits must not clip wrapped recommendation titles. */
.sw-list button.sw-row { appearance: none; box-sizing: border-box; height: auto; max-height: none; min-height: 0; min-width: 0; margin: 0; flex-shrink: 0; white-space: normal; }
.sw-row::after { content: ""; position: absolute; inset-inline: 8px; bottom: 0; height: 1px; background: var(--ui-border); pointer-events: none; }
.sw-row:last-child::after { display: none; }
.sw-row:hover { background: var(--ui-hover); }
.sw-row:active { background: var(--ui-active); }
.sw-source { display: block; box-sizing: border-box; width: 100%; height: auto; max-height: none; margin: 4px 0 8px; padding: 8px 10px; text-align: start; white-space: normal; border: 0; border-inline-start: 2px solid var(--ui-accent); border-radius: 0; background: var(--ui-active); color: var(--ui-fg); font: 13px/1.4 var(--ui-font); cursor: pointer; }
.sw-source-label { display: block; color: var(--ui-accent); font-size: 11px; margin-bottom: 2px; }
.sw-source:focus-visible, .sw-row:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
.sw-rank { min-width: 14px; padding-top: 2px; font-size: 11px; color: var(--ui-muted); }
.sw-main { flex: 1 1 auto; min-width: 0; }
.sw-title { overflow-wrap: anywhere; font-size: 13px; font-weight: 600; line-height: 1.45; color: var(--ui-fg); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sw-meta { font-size: 11px; color: var(--ui-muted); line-height: 1.5; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-side { flex: none; width: max-content; max-width: 74px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; padding-top: 1px; }
.sw-num { font-size: 11px; font-weight: 500; color: var(--ui-accent); font-variant-numeric: tabular-nums; }
.sw-track { width: 52px; height: 4px; border-radius: 2px; background: var(--ui-border); overflow: hidden; }
.sw-bar { height: 100%; border-radius: 2px; background: var(--ui-accent); }
.sw-flag { font-size: 10px; color: var(--ui-muted); white-space: nowrap; }
.sw-result { min-width: 0; }
.sw-evidence { padding: 0 10px 8px 30px; font: 12px/1.5 var(--ui-font); }
.sw-evidence summary { color: var(--ui-muted); cursor: pointer; }
.sw-evidence p { margin: 6px 0; color: var(--ui-muted); }
.sw-evidence blockquote { margin: 6px 0 10px; padding-inline-start: 10px; border-inline-start: 2px solid var(--ui-border); }
`;

var SWSection = {
  _navigation: new WeakMap(),
  _rootURI: null,
  _registered: null,
  _active: [],
  _stopped: false,
  _windows: new Set(),
  _tagMenus: new Map(),
  init(rootURI) {
    this._rootURI = rootURI;
  },

  getItemPaneCallbacks() {
    var self = this;
    return {
      onDestroy: ({ body }) => {
        body._swToken = (body._swToken || 0) + 1;
        self._clearPaging(body);
        self._active = self._active.filter((e) => e.body !== body);
      },
      onItemChange: (props) => {
        var { body, item, setEnabled } = props;
        const win = body.ownerDocument.defaultView;
        const navigation = self._navigation.get(win);
        if (navigation && item?.id !== navigation.targetID) {
          self._navigation.delete(win);
          const source = body.querySelector(".sw-source");
          if (source) {
            source.hidden = true;
            source.replaceChildren();
            source.onclick = null;
          }
        }
        if (!item || body._swSelectionKey !== SWIndexer.docKey(item)) {
          self._clearPaging(body);
          body._swToken = (body._swToken || 0) + 1;
        }
        self._active = self._active.filter((e) => e.body !== body);
        var supported =
          !!item &&
          !item.isNote() &&
          !item.isFeedItem &&
          (item.isRegularItem() || item.isAttachment());
        setEnabled(supported);
        if (supported) self._track(props);
        return true;
      },
      onRender: ({ body }) => {
        self.ensureSkeleton(body);
      },
      onAsyncRender: (props) => {
        return self.renderBody(props);
      },
      onToggle: (props) => self.renderBody(props),
      onRefresh: (props) => self.renderBody(props, true),
      onCollapse: ({ body }) => {
        body._swToken = (body._swToken || 0) + 1;
        body._swResultsSignature = null;
        self._clearPaging(body);
        body._swWork = null;
        body.setAttribute("aria-busy", "false");
        const progress = body.querySelector(".sw-computation-progress");
        if (progress) progress.hidden = true;
      },
    };
  },

  ensureSkeleton(body) {
    if (!body || body.querySelector(".sw-list")) return;
    var doc = body.ownerDocument;
    var list = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    list.className = "sw-list";
    var status = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    status.className = "sw-status";
    status.setAttribute("role", "status");
    status.hidden = true;
    var progress = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "progress",
    );
    progress.className = "sw-computation-progress";
    progress.max = 100;
    progress.hidden = true;
    progress.setAttribute("data-l10n-id", "similar-works-progress");
    var source = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
    source.type = "button";
    source.className = "sw-source";
    source.hidden = true;
    body.replaceChildren(source, status, progress, list);
  },

  async fmt(doc, id, args, fallback) {
    try {
      var s = await doc.l10n.formatValue(id, args || undefined);
      if (s) {
        return s;
      }
    } catch (e) {}
    return fallback;
  },

  _track(props) {
    this._active = this._active.filter(
      (e) => e.body.isConnected && e.body !== props.body,
    );
    this._active.push(props);
  },

  setStatus(body, text, clearRows = true) {
    var status = body.querySelector(".sw-status");
    if (status) {
      status.textContent = text;
      status.hidden = !text;
    }
    if (!clearRows) return;
    this._clearPaging(body);
    body._swResultsSignature = null;
    var rows = body.querySelectorAll(".sw-row");
    for (let r of rows) {
      r.remove();
    }
  },

  async renderBody(props, compute = false) {
    var body = props.body;
    if (body?.hidden) return;
    var key = props.item && SWIndexer.docKey(props.item);
    if (!compute && body?._swWork && body._swWorkKey === key) return;
    var token;
    var work = (async () => {
      try {
        var pending = this._renderBody(props, compute);
        token = body?._swToken;
        await pending;
      } catch (e) {
        Zotero.logError(e);
        if (!this._stopped && body && body._swToken === token) {
          // Preserve usable cached rows if revalidation fails.
          this.setStatus(body, String(e.message || e), false);
        }
      } finally {
        if (body && body._swToken === token) {
          body.setAttribute("aria-busy", "false");
          var progress = body.querySelector(".sw-computation-progress");
          if (progress) progress.hidden = true;
        }
      }
    })();
    if (body) {
      body._swWork = work;
      body._swWorkKey = key;
    }
    try {
      await work;
    } finally {
      if (body?._swWork === work) body._swWork = null;
    }
  },

  async _renderBody(props, compute) {
    var { body, item, setSectionSummary } = props;
    if (this._stopped || !body || !item) {
      return;
    }
    var doc = body.ownerDocument;
    var selectionKey = SWIndexer.docKey(item);
    var token =
      (body._swToken || 0) +
      (compute || body._swSelectionKey !== selectionKey ? 1 : 0);
    body._swToken = token;
    var show = async (id, args, fallback, suffix = "") => {
      var text = await this.fmt(doc, id, args, fallback);
      if (!this._stopped && body._swToken === token)
        this.setStatus(body, text + suffix);
    };
    this._track(props);
    this.ensureSkeleton(body);
    if (body._swSelectionKey !== selectionKey) {
      body._swSelectionKey = selectionKey;
      body.querySelector(".sw-computation-progress").hidden = true;
      body.setAttribute("aria-busy", "false");
      body._swResultsSignature = null;
      this.setStatus(body, "");
      if (setSectionSummary) setSectionSummary("");
    }

    this._presentSource(props);
    var sectionEl = body.closest ? body.closest("collapsible-section") : null;
    if (sectionEl?.open === false || body.hidden) {
      body._swPending = true;
      return;
    }
    body._swPending = false;

    if (compute) {
      this.setStatus(body, "", false);
      body.setAttribute("aria-busy", "true");
      var progressBar = body.querySelector(".sw-computation-progress");
      progressBar.hidden = false;
      progressBar.removeAttribute("value");
    }

    var corpus = SWIndexer.corpus;
    if (!corpus) {
      if (compute)
        await show(
          "similar-works-unavailable",
          null,
          "Similarity index unavailable",
        );
      return;
    }
    var target = await SWIndexer.resolveDocItem(item);
    if (!target || body._swToken !== token || this._stopped) return;
    var docKey = SWIndexer.docKey(target);
    const method = Zotero.isMac ? "hybrid" : "text";
    if (body._swMethod !== method) {
      body._swMethod = method;
      this.setStatus(body, "");
    }
    var includeWeak = SWPref("allowMetadataOnlyRecommendations", true);
    let restored = null;
    if (!compute) {
      // Cached rows need the database, not the full in-memory search index.
      await corpus.opened;
      if (this._stopped || body._swToken !== token) return;
      restored = await corpus.getRecommendations(docKey, includeWeak, method);
      if (method === "hybrid" && restored?.model !== SWSemantic.version)
        restored = null;
      if (restored)
        await this._presentMatches(props, restored.matches, docKey, token);
      if (this._stopped || body._swToken !== token) return;
    }
    if (corpus.progress.phase !== "ready") {
      if (!compute && !restored && corpus.progress.phase !== "error") {
        this.setStatus(body, "");
        if (body._swToken !== token || this._stopped) return;
        body.setAttribute("aria-busy", "true");
        const preparingProgress = body.querySelector(
          ".sw-computation-progress",
        );
        preparingProgress.hidden = false;
        preparingProgress.removeAttribute("value");
      }
      await corpus.ready;
      if (body._swToken !== token || this._stopped) return;
    }
    if (corpus.progress.phase === "error") {
      var errDetail = corpus.progress.error
        ? " (" + corpus.progress.error + ")"
        : "";
      if (restored) {
        const message = await this.fmt(
          doc,
          "similar-works-unavailable",
          null,
          "Index unavailable",
        );
        if (body._swToken !== token || this._stopped) return;
        this.setStatus(body, message + errDetail, false);
        body.setAttribute("aria-busy", "false");
        body.querySelector(".sw-computation-progress").hidden = true;
        return;
      }
      await show(
        "similar-works-unavailable",
        null,
        "Index unavailable",
        errDetail,
      );
      return;
    }
    if (corpus.progress.phase !== "ready") return;

    if (method === "hybrid") {
      await this._renderHybrid(props, target, docKey, token, compute);
      return;
    }
    var cached = compute
      ? null
      : await corpus.getRecommendations(docKey, includeWeak);
    if (body._swToken !== token || this._stopped) return;
    if (cached && cached !== restored)
      await this._presentMatches(props, cached.matches, docKey, token);
    if (body._swToken !== token || this._stopped) return;
    // Avoid spending CPU on items the user only passes while browsing.
    if (!compute) await swYield(120);
    if (body._swToken !== token || this._stopped || sectionEl?.open === false)
      return;
    if (compute) await SWIndexer.ensureNow(item);
    else await SWIndexer.ensureForDisplay(item);
    if (body._swToken !== token) {
      return;
    }
    if (!target) {
      await show(
        "similar-works-no-text",
        null,
        "No analyzable full text or abstract for this item",
      );
      return;
    }
    if (!corpus.docs.has(docKey)) {
      await show(
        "similar-works-no-text",
        null,
        "No analyzable full text or abstract for this item",
      );
      return;
    }

    if (!compute && corpus.recommendationsFresh(cached, docKey)) return;
    // Coalesce corpus changes instead of repeatedly scoring during a bulk import.
    if (!compute && cached) {
      const waitingSince = Date.now();
      while (
        Date.now() - corpus.lastChangedAt < 2500 &&
        Date.now() - waitingSince < 5000
      ) {
        await swYield(250);
        if (
          this._stopped ||
          body._swToken !== token ||
          sectionEl?.open === false
        )
          return;
      }
    }
    progressBar = body.querySelector(".sw-computation-progress");
    this.setStatus(body, "", false);
    body.setAttribute("aria-busy", "true");
    progressBar.hidden = !!cached && !compute;
    var queryDoc = corpus.docs.get(docKey);
    if (!queryDoc) {
      await show(
        "similar-works-no-text",
        null,
        "No analyzable full text or abstract for this item",
      );
      return;
    }
    var epoch = corpus.search.epoch;
    var revision = corpus.revision;
    var queryHash = queryDoc.hash;
    var lastProgress = 0;
    var matches = await corpus.scoreTopKAsync(
      docKey,
      100,
      (key, d) =>
        key.startsWith(target.libraryID + "/") && (includeWeak || !d.weak),
      () =>
        this._stopped || body._swToken !== token || sectionEl?.open === false,
      ({ done, total }) => {
        if (this._stopped || body._swToken !== token) return;
        if (done < total && Date.now() - lastProgress < 100) return;
        lastProgress = Date.now();
        progressBar.value = total ? Math.min(100, (done / total) * 100) : 100;
      },
      30,
      (currentRevision, currentHash, currentEpoch) => {
        epoch = currentEpoch;
        revision = currentRevision;
        queryHash = currentHash;
      },
    );
    if (body._swToken !== token) {
      return;
    }

    if (this._stopped || sectionEl?.open === false) return;
    await corpus.saveRecommendations(
      docKey,
      includeWeak,
      matches,
      revision,
      queryHash,
      epoch,
    );
    if (body._swToken !== token || this._stopped) return;
    await this._presentMatches(props, matches, docKey, token);
  },

  refreshSemantic() {
    if (this._stopped || !Zotero.isMac) return;
    for (const props of [...this._active])
      if (props.body.isConnected) void this.renderBody(props);
  },

  async _renderHybrid(props, target, key, token, compute) {
    const body = props.body;
    await SWSemantic.start(SWIndexer.corpus);
    if (body._swToken !== token || this._stopped) return;
    if (
      !SWSemantic._enabled ||
      (compute && SWSemantic.status.state === "error")
    )
      SWSemantic.enable();
    const includeWeak = SWPref("allowMetadataOnlyRecommendations", true);
    const cached = compute
      ? null
      : SWSemantic.getRecommendations(key, includeWeak);
    if (cached && !cached.dirty) {
      await this._presentMatches(props, cached.matches, key, token);
      if (body._swToken !== token || this._stopped) return;
      if (SWSemantic.recommendationsFresh(cached, key)) return;
    }
    if (compute) await SWIndexer.ensureNow(target);
    else await SWIndexer.ensureForDisplay(target);
    if (body._swToken !== token || this._stopped) return;
    SWSemantic.enqueue(key, true);
    const result = await SWSemantic.recommend(
      key,
      100,
      (candidate, doc) =>
        candidate.startsWith(target.libraryID + "/") &&
        (includeWeak || !doc.weak),
      () =>
        this._stopped ||
        body._swToken !== token ||
        body.closest?.("collapsible-section")?.open === false,
    );
    if (body._swToken !== token || this._stopped) return;
    if (!result) return;
    const saving = SWSemantic.saveRecommendations(
      key,
      includeWeak,
      result.matches,
      result.snapshot,
    );
    try {
      if (body._swToken !== token || this._stopped) return;
      await this._presentMatches(props, result.matches, key, token);
    } finally {
      await saving;
    }
  },

  async _presentMatches(props, matches, docKey, token) {
    var { body, setSectionSummary } = props;
    var doc = body.ownerDocument;
    var corpus = SWIndexer.corpus;
    if (setSectionSummary) setSectionSummary("");
    var rows = await this._resolveRows(matches, body._swMethod);
    if (body._swToken !== token) {
      return;
    }

    var list = body.querySelector(".sw-list");
    if (!rows.length) {
      var emptyText = await this.fmt(
        doc,
        "similar-works-empty",
        null,
        "No similar items found in this library",
      );
      if (body._swToken !== token || this._stopped) return;
      this.setStatus(body, emptyText);
      if (body._swToken !== token) return;
      if (setSectionSummary) setSectionSummary("");
      return;
    }
    var top = rows[0].score;
    var weakFlag = await this.fmt(
      doc,
      "similar-works-based-on-weak",
      null,
      "metadata only",
    );

    var queryWeak = corpus.docs.get(docKey)?.weak;
    if (this._stopped || body._swToken !== token) return;
    this.setStatus(body, queryWeak ? weakFlag : "", false);
    const batch = SWResultLimit(SWPref("maxRecommendations", 20));
    var signature = JSON.stringify([
      batch,
      rows.map((r) => [
        r.item.id,
        r.item.getField("title"),
        r.item.getField("date"),
        r.item.getCreators(),
        r.score.toFixed(3),
        r.weak,
      ]),
    ]);
    if (this._stopped || body._swToken !== token) return;
    if (body._swResultsSignature === signature && body._swPaging) {
      body._swPaging.token = token;
      body._swPaging.props = props;
      return;
    }
    const visible =
      body._swPaging?.key === docKey && body._swPaging.batch === batch
        ? body._swPaging.next
        : 0;
    this._clearPaging(body);
    list.replaceChildren();
    const more = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
    more.className = "sw-more";
    more.type = "button";
    more.textContent = await this.fmt(doc, "similar-works-more", null, "More");
    if (this._stopped || body._swToken !== token) return;
    const state = {
      key: docKey,
      token,
      props,
      rows,
      next: 0,
      batch,
      weakFlag,
      top,
      more,
      observer: null,
    };
    body._swPaging = state;
    more.addEventListener("click", () => this._loadMore(body));
    const Observer = doc.defaultView?.IntersectionObserver;
    if (Observer)
      state.observer = new Observer((entries) => {
        if (
          entries.some((entry) => entry.isIntersecting) &&
          body._swPaging === state
        )
          this._loadMore(body);
      });
    this._loadMore(body, Math.max(batch, visible));
    body._swResultsSignature = signature;
  },

  _clearPaging(body) {
    const state = body._swPaging;
    if (!state) return;
    state.observer?.disconnect();
    state.more.remove();
    body._swPaging = null;
  },

  _loadMore(body, count = body._swPaging?.batch) {
    const state = body._swPaging;
    if (
      !state ||
      this._stopped ||
      !body.isConnected ||
      body._swToken !== state.token
    )
      return;
    state.observer?.disconnect();
    state.more.remove();
    const list = body.querySelector(".sw-list");
    const end = Math.min(state.rows.length, state.next + count);
    for (; state.next < end; state.next++)
      list.appendChild(
        this._createRow(
          state.props,
          state.rows[state.next],
          state.next + 1,
          state.top,
          state.weakFlag,
        ),
      );
    if (state.next < state.rows.length) {
      list.appendChild(state.more);
      state.observer?.observe(state.more);
    }
  },

  _createRow(props, r, rank, top, weakFlag) {
    const doc = props.body.ownerDocument;
    const method = props.body._swMethod;
    var row = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
    row.type = "button";
    row.className = "sw-row";
    var rankLabel = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    rankLabel.className = "sw-rank";
    rankLabel.textContent = String(rank);
    row.appendChild(rankLabel);
    var main = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    main.className = "sw-main";
    var title = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    title.className = "sw-title";
    title.textContent = r.item.getField("title") || r.item.getDisplayTitle();
    var meta = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    meta.className = "sw-meta";
    var year = "";
    try {
      var m = String(r.item.getField("date") || "").match(/\d{4}/);
      year = m ? m[0] : "";
    } catch (e) {}
    var creator = "";
    try {
      var cs = r.item.getCreators();
      creator = cs && cs.length ? cs[0].lastName : "";
    } catch (e) {}
    meta.textContent = [year, creator].filter(Boolean).join(" · ");
    main.appendChild(title);
    main.appendChild(meta);

    var side = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    side.className = "sw-side";
    var num = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    num.className = "sw-num";
    num.textContent =
      method === "hybrid" ? "" : (r.score * 100).toFixed(1) + "%";
    var track = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    track.className = "sw-track";
    var bar = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    bar.className = "sw-bar";
    bar.style.width =
      Math.max(3, (r.score / (top || 1)) * 100).toFixed(1) + "%";
    track.appendChild(bar);
    side.appendChild(num);
    side.appendChild(track);

    row.appendChild(main);
    row.appendChild(side);
    if (r.weak) {
      var flag = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      flag.className = "sw-flag";
      flag.textContent = weakFlag;
      side.appendChild(flag);
    }

    let itemId = r.item.id;
    let srcTabType = props.tabType;
    row.addEventListener("click", () =>
      this._selectItem(doc, itemId, srcTabType, props.item),
    );
    const wrapper = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    wrapper.className = "sw-result";
    const evidence = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "details",
    );
    evidence.className = "sw-evidence";
    evidence.hidden = true;
    const heading = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "summary",
    );
    heading.setAttribute("data-l10n-id", "similar-works-evidence");
    evidence.append(heading);
    let loaded = false,
      loading = false;
    const token = props.body._swToken;
    const active = () =>
      !this._stopped && wrapper.isConnected && props.body._swToken === token;
    evidence.addEventListener("toggle", async () => {
      if (evidence.hidden || !evidence.open || loading || loaded || !active())
        return;
      loading = true;
      try {
        const result = await SWEvidence.compareItems(
          props.item,
          r.item,
          active,
        );
        if (!active() || !result) return;
        const terms = doc.createElementNS("http://www.w3.org/1999/xhtml", "p");
        terms.textContent =
          result.terms.join(" · ") ||
          (await this.fmt(doc, "similar-works-evidence-empty"));
        evidence.append(terms);
        for (const [key, label] of [
          ["current", "similar-works-evidence-current"],
          ["match", "similar-works-evidence-match"],
        ]) {
          if (!result[key].text) continue;
          const title = doc.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "strong",
          );
          title.textContent = await this.fmt(doc, label);
          const excerpt = doc.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "blockquote",
          );
          excerpt.textContent = result[key].text;
          if (active()) evidence.append(title, excerpt);
        }
        loaded = true;
      } catch (error) {
        Zotero.logError(error);
        if (active())
          evidence.append(
            doc.createTextNode(
              await this.fmt(doc, "similar-works-evidence-failed"),
            ),
          );
      } finally {
        loading = false;
      }
    });
    wrapper.append(row, evidence);
    return wrapper;
  },

  async _resolveRows(matches, method = "text") {
    var out = [];
    const minimum = Number(SWPref("minimumSimilarity", 0.05));
    for (var m of SWSearch.relevant(matches, method, minimum)) {
      var idx = m.key.indexOf("/");
      if (idx < 1) {
        continue;
      }
      var it = null;
      try {
        it = await Zotero.Items.getByLibraryAndKeyAsync(
          parseInt(m.key.substring(0, idx)),
          m.key.substring(idx + 1),
        );
      } catch (e) {}
      if (!it || it.deleted || it.isFeedItem || it.parentItemID) {
        continue;
      }
      out.push({ item: it, score: m.score, weak: m.weak });
    }
    return out;
  },

  _presentSource(props) {
    const { body, item, tabType } = props;
    const doc = body.ownerDocument;
    const source = body.querySelector(".sw-source");
    const navigation = this._navigation.get(doc.defaultView);
    source.replaceChildren();
    source.hidden = true;
    source.onclick = null;
    if (navigation?.targetID !== item.id || navigation.source.deleted) return;
    const label = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    label.className = "sw-source-label";
    label.setAttribute("data-l10n-id", "similar-works-source");
    const title = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    title.className = "sw-title";
    title.textContent =
      navigation.source.getField("title") ||
      navigation.source.getDisplayTitle();
    source.appendChild(label);
    source.appendChild(title);
    source.hidden = false;
    source.onclick = () =>
      this._selectItem(doc, navigation.source.id, tabType, item);
  },

  async _selectItem(doc, itemId, tabType, sourceItem) {
    try {
      if (this._stopped) return;
      const source = await SWIndexer.resolveDocItem(sourceItem);
      if (!source || this._stopped) return;
      const win = doc.defaultView;
      const zp = win?.ZoteroPane || Zotero.getActiveZoteroPane();
      if (!zp) return;
      const targetDoc = zp.document || doc;
      const targetWin = targetDoc.defaultView;
      const navigation = { source, targetID: itemId };
      this._navigation.set(targetWin, navigation);
      if (tabType !== "library" && win?.Zotero_Tabs)
        win.Zotero_Tabs.select("zotero-pane");
      await zp.selectItem(itemId);
      if (this._stopped || this._navigation.get(targetWin) !== navigation)
        return;
      const details = targetDoc
        .getElementById?.("zotero-item-pane")
        ?.querySelector("item-details");
      const section = details?.getPane(this._registered);
      if (section) {
        section.querySelector("collapsible-section").open = true;
        section.querySelector('button[data-view="similar"]')?.click();
        await details.scrollToPane(this._registered, "instant");
      }
    } catch (e) {
      Zotero.logError(e);
    }
  },

  injectWindow(win) {
    try {
      win.MozXULElement.insertFTLIfNeeded("similar-works.ftl");
    } catch (e) {}
    win.similarWorksStatus = () => ({
      ...SWIndexer.getStatus(),
      indexProgress: { ...SWIndexer.corpus?.progress },
      vectorTotal: SWIndexer.corpus?.docs.size || 0,
      model: SWSemantic.model,
      dimensions: SWSemantic.dimensions,
      modelVersion: SWSemantic.version,
      version: SWPlugin.version,
      rootURI: this._rootURI,
    });
    var doc = win.document;
    if (!doc.getElementById("similar-works-style")) {
      var style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
      style.id = "similar-works-style";
      style.textContent = SW_CSS;
      doc.documentElement.appendChild(style);
    }
    const popup = doc.getElementById("menu_ToolsPopup");
    if (popup && !this._tagMenus.has(win)) {
      const menu = doc.createXULElement("menuitem");
      menu.id = "similar-works-organize-tags";
      menu.classList.add("menuitem-iconic");
      menu.setAttribute(
        "image",
        "chrome://knowledge-base/content/icons/ui/tag-manager.svg",
      );
      menu.setAttribute("data-l10n-id", "similar-works-tags-menu");
      const showing = () => {
        const libraryID = win.ZoteroPane.getSelectedLibraryID();
        const library = Zotero.Libraries.get(libraryID);
        menu.disabled = !library || !library.editable;
      };
      menu.addEventListener("command", () => {
        try {
          SWTags.open(win, win.ZoteroPane.getSelectedLibraryID());
        } catch (error) {
          Zotero.logError(error);
        }
      });
      popup.addEventListener("popupshowing", showing);
      popup.appendChild(menu);
      this._tagMenus.set(win, () => {
        popup.removeEventListener("popupshowing", showing);
        menu.remove();
      });
    }
    this._windows.add(win);
  },

  removeWindow(win) {
    this._navigation.delete(win);
    this._tagMenus.get(win)?.();
    this._tagMenus.delete(win);
    delete win.similarWorksStatus;
    try {
      var doc = win.document;
      var style = doc.getElementById("similar-works-style");
      if (style) {
        style.remove();
      }
      var link = doc.querySelector('link[href="similar-works.ftl"]');
      if (link) {
        link.remove();
      }
    } catch (e) {}
    this._windows.delete(win);
  },

  shutdown() {
    this._stopped = true;
    this._navigation = new WeakMap();

    for (var entry of this._active) {
      entry.body._swToken++;
      this._clearPaging(entry.body);
    }
    for (var win of Array.from(this._windows)) {
      this.removeWindow(win);
    }
    this._active = [];
    this._registered = null;
  },
};
