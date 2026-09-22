import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestRecords } from "../src/lib/evidence/records";
import { treatAsFullTextRead } from "../src/lib/evidence/access";
import { linkIsNotFullTextRead, putFullTextBody, recordFailedFullTextFetch, recordSectionRead } from "../src/lib/evidence/fulltext";

test("access_rises_to_full_text_only_after_store_put", () => {
  const { items } = ingestRecords(
    [{ title: "Invented JATS report", authors: "A", year: 2021, venue: "J", doi: "10.1234/synth.ft", abstract: "metadata abstract only" }],
    { id: "r1", provider: "f" },
  );
  const withLink = { ...items[0], notes: "full-text url: https://example.invalid/full.xml" };
  assert.equal(treatAsFullTextRead(withLink), false);
  assert.equal(linkIsNotFullTextRead(withLink, "https://example.invalid/full.xml"), true);

  const failed = recordFailedFullTextFetch(withLink, "HTTP 403 publisher gate");
  assert.equal(treatAsFullTextRead(failed), false);
  assert.equal(failed.provenance.access, "abstract");
  assert.equal(failed.fullTextAccess?.ok, false);
  assert.match(failed.fullTextAccess && failed.fullTextAccess.ok === false ? failed.fullTextAccess.note : "", /403/);

  const body = "<article><body><sec id='s1'><title>Methods</title><p>SYNTHETIC methods.</p></sec><sec id='s2'><title>Results</title><p>SYNTHETIC results.</p></sec></body></article>";
  const stored = putFullTextBody(failed, body, { mediaType: "application/xml" });
  assert.equal(treatAsFullTextRead(stored.item, [stored.document]), false);
  assert.equal(stored.item.fullTextRead?.complete, false);
  assert.equal(stored.item.provenance.access === "full-text", false);
  assert.ok(stored.document.text.includes("SYNTHETIC results"));

  const readMethods = recordSectionRead(stored.item, stored.document, [{ id: "s1", heading: "Methods" }]);
  assert.equal(treatAsFullTextRead(readMethods, [stored.document]), false);
  const readAll = recordSectionRead(readMethods, stored.document, [{ id: "s2", heading: "Results" }]);
  assert.equal(readAll.fullTextRead?.complete, true);
  assert.equal(readAll.provenance.access, "full-text");
  assert.equal(treatAsFullTextRead(readAll, [stored.document]), true);
});
test("treatAsFullTextRead_requires_bound_full_text_document_and_all_read_manifest", () => {
  const { items } = ingestRecords(
    [{ title: "Bound full text", authors: "A", year: 2022, venue: "J", doi: "10.1234/synth.bind", abstract: "metadata abstract only" }],
    { id: "r-bind", provider: "f" },
  );
  const body = "<article><body><sec id='s1'><title>Methods</title><p>SYNTHETIC methods only.</p></sec></body></article>";
  const stored = putFullTextBody(items[0], body);
  const read = recordSectionRead(stored.item, stored.document, [{ id: "s1", heading: "Methods" }]);
  assert.equal(read.fullTextRead?.complete, true);
  assert.equal(treatAsFullTextRead(read, [stored.document]), true);

  assert.equal(treatAsFullTextRead(read, []), false);
  assert.equal(treatAsFullTextRead(read), false);

  assert.equal(
    treatAsFullTextRead(read, [
      { id: stored.document.id, recordId: "ev-other", sourceScope: "abstract", text: stored.document.text },
    ]),
    false,
  );

  assert.equal(
    treatAsFullTextRead(read, [
      { id: "doc-unrelated", recordId: read.id, sourceScope: "full-text", text: stored.document.text },
    ]),
    false,
  );

  const unread = {
    ...read,
    provenance: { ...read.provenance, access: "full-text" as const },
    fullTextRead: {
      documentId: stored.document.id,
      sections: [{ id: "s1", heading: "Methods", read: false }],
      complete: true,
      at: read.fullTextRead!.at,
    },
  };
  assert.equal(treatAsFullTextRead(unread, [stored.document]), false);
});
