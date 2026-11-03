// Inspect source identities without hydrating every Zotero item or reading PDFs.
var SWLibrarySources = {
  async scan(cancelled = () => false, documentID = null) {
    const documents = new Map(),
      items = new Map(),
      children = [];
    let afterID = 0;
    while (!cancelled()) {
      const rows = await Zotero.DB.queryAsync(
        `SELECT i.itemID, i.libraryID, i.key, i.itemTypeID,
          i.dateModified, i.clientDateModified, i.version,
          a.parentItemID, a.contentType, a.linkMode, a.path
         FROM items i JOIN libraries l USING (libraryID)
         LEFT JOIN itemAttachments a USING (itemID)
         WHERE i.itemID > ? AND l.type != 'feed'
          ${documentID === null ? "" : "AND (i.itemID = ? OR a.parentItemID = ?)"}
          AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
          AND i.itemID NOT IN (SELECT itemID FROM itemNotes)
          AND i.itemID NOT IN (SELECT itemID FROM itemAnnotations)
          AND (a.parentItemID IS NULL OR a.parentItemID NOT IN
            (SELECT itemID FROM deletedItems))
         ORDER BY i.itemID LIMIT 200`,
        documentID === null ? [afterID] : [afterID, documentID, documentID],
      );
      if (!rows.length) break;
      afterID = rows[rows.length - 1].itemID;
      const ids = rows.map((row) => row.itemID);
      const placeholders = ids.map(() => "?").join(",");
      const data = new Map(ids.map((id) => [id, []]));
      // Value IDs catch edits even when Zotero's second-resolution dates match.
      for (const row of await Zotero.DB.queryAsync(
        `SELECT itemID, fieldID, valueID FROM itemData WHERE itemID IN (${placeholders}) ORDER BY itemID, fieldID`,
        ids,
      ))
        data.get(row.itemID).push([row.fieldID, row.valueID]);
      for (const row of await Zotero.DB.queryAsync(
        `SELECT ic.itemID, ic.orderIndex, ic.creatorTypeID, c.firstName, c.lastName, c.fieldMode
         FROM itemCreators ic JOIN creators c USING (creatorID)
         WHERE ic.itemID IN (${placeholders}) ORDER BY ic.itemID, ic.orderIndex`,
        ids,
      ))
        data
          .get(row.itemID)
          .push([
            row.orderIndex,
            row.creatorTypeID,
            row.firstName,
            row.lastName,
            row.fieldMode,
          ]);
      // Bound concurrent filesystem work; inspect every attachment so a newly
      // available preferred PDF invalidates a previously selected source.
      for (let offset = 0; offset < rows.length && !cancelled(); offset += 4) {
        await Promise.all(
          rows.slice(offset, offset + 4).map(async (row) => {
            let file = null;
            if (
              row.contentType &&
              (Zotero.Fulltext.isCachedMIMEType(row.contentType) ||
                row.contentType === "text/plain")
            ) {
              const path =
                Zotero.Attachments.getStorageDirectoryByLibraryAndKey(
                  row.libraryID,
                  row.key,
                );
              path.append(Zotero.Fulltext.fulltextCacheFile);
              try {
                const stat = await IOUtils.stat(path.path);
                file = [stat.lastModified, stat.size];
              } catch (error) {
                if (error.name !== "NotFoundError") throw error;
              }
            }
            const key = row.libraryID + "/" + row.key;
            items.set(row.itemID, { key, parentID: row.parentItemID });
            const stamp = JSON.stringify([
              row.itemID,
              row.key,
              row.itemTypeID,
              row.dateModified,
              row.clientDateModified,
              row.version,
              row.parentItemID,
              row.contentType,
              row.linkMode,
              row.path,
              data.get(row.itemID),
              file,
            ]);
            if (row.parentItemID)
              children.push([row.parentItemID, row.itemID, stamp]);
            else
              documents.set(row.itemID, {
                id: row.itemID,
                key,
                parts: [stamp],
              });
          }),
        );
        await swYield(0);
      }
    }
    if (cancelled()) return null;
    children.sort((a, b) => a[1] - b[1]);
    for (const [id, , stamp] of children) documents.get(id)?.parts.push(stamp);
    return {
      items,
      documents: [...documents.values()].map(({ id, key, parts }) => ({
        id,
        key,
        stamp: JSON.stringify(parts),
      })),
    };
  },
};
