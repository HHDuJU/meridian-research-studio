import type { ReportBlock, ReportDocument } from "./evidence/search-report";

/*
 * Word (.docx) rendering of a Meridian report document (search report now; manuscript and statistics
 * reports use the same blocks). Loaded only when the investigator asks for a Word file, so the `docx`
 * library stays out of the page's first load.
 *
 * Layout: US Letter, 1 inch margins, Calibri 11 pt, strategies and requests in Consolas 9.5 pt so they can
 * be copied back exactly; tables use fixed widths in twentieths of a point (DXA), which Word, LibreOffice and
 * Google Docs all honour.
 */

const PAGE_WIDTH = 12240;
const PAGE_HEIGHT = 15840;
const MARGIN = 1440;
export const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

const BODY_FONT = "Calibri";
const MONO_FONT = "Consolas";
const GREY = "595959";
const RULE = "BFBFBF";
const HEAD_FILL = "EDEDED";

/** Split `total` into whole-number widths in proportion to `weights`, summing exactly to `total`. */
export function columnWidths(weights: number[], total = CONTENT_WIDTH): number[] {
  const w = weights.length ? weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 1)) : [1];
  const sum = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => Math.floor((x / sum) * total));
  raw[raw.length - 1] += total - raw.reduce((a, b) => a + b, 0);
  return raw;
}

export async function reportToDocxBlob(doc: ReportDocument): Promise<Blob> {
  const d = await buildDocx(doc);
  const { Packer } = await import("docx");
  return Packer.toBlob(d);
}

export async function reportToDocxBuffer(doc: ReportDocument): Promise<Uint8Array> {
  const d = await buildDocx(doc);
  const { Packer } = await import("docx");
  return new Uint8Array(await Packer.toBuffer(d));
}

async function buildDocx(doc: ReportDocument) {
  const docx = await import("docx");
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    HeadingLevel,
    LevelFormat,
    PageNumber,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = docx;

  const border = { style: BorderStyle.SINGLE, size: 4, color: RULE };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

  const text = (value: string, opts: { mono?: boolean; bold?: boolean; color?: string; size?: number } = {}) =>
    new TextRun({ text: value, font: opts.mono ? MONO_FONT : BODY_FONT, size: opts.size ?? (opts.mono ? 19 : 22), bold: opts.bold, color: opts.color });

  const cellParagraphs = (value: string, opts: { mono?: boolean; bold?: boolean } = {}) =>
    (value === "" ? [""] : value.split("\n")).map((line) => new Paragraph({ children: [text(line, { ...opts, size: opts.mono ? 18 : 20 })], spacing: { after: 0 } }));

  const table = (head: string[] | null, rows: { cells: string[]; mono?: boolean[] }[], weights: number[]) => {
    const widths = columnWidths(weights);
    const mk = (cells: string[], header: boolean, mono: boolean[] = []) =>
      new TableRow({
        tableHeader: header,
        cantSplit: !header && cells.join("").length < 600,
        children: cells.map(
          (c, i) =>
            new TableCell({
              width: { size: widths[i], type: WidthType.DXA },
              borders,
              margins: cellMargins,
              shading: header ? { fill: HEAD_FILL, type: ShadingType.CLEAR, color: "auto" } : undefined,
              children: cellParagraphs(c, { bold: header, mono: !!mono[i] }),
            }),
        ),
      });
    return new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: widths,
      rows: [...(head ? [mk(head, true)] : []), ...rows.map((r) => mk(r.cells, false, r.mono))],
    });
  };

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
  children.push(new Paragraph({ children: [text(doc.title, { bold: true, size: 32 })], spacing: { after: 120 } }));
  for (const line of doc.subtitle) children.push(new Paragraph({ children: [text(line, { color: GREY })], spacing: { after: 40 } }));
  children.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 4 } }, spacing: { after: 200 } }));

  for (const b of doc.blocks as ReportBlock[]) {
    if (b.kind === "heading") {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text(b.text, { bold: true, size: 26 })], spacing: { before: 280, after: 120 }, keepNext: true }));
    } else if (b.kind === "para") {
      children.push(new Paragraph({ children: [text(b.text, { color: b.note ? GREY : undefined, size: b.note ? 20 : 22 })], spacing: { after: 140, line: 276 } }));
    } else if (b.kind === "bullets") {
      for (const item of b.items) children.push(new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [text(item, { size: 21 })], spacing: { after: 80 } }));
    } else if (b.kind === "numbered") {
      for (const item of b.items) children.push(new Paragraph({ numbering: { reference: "numbers", level: 0 }, children: [text(item, { size: 21 })], spacing: { after: 80 } }));
    } else if (b.kind === "table") {
      children.push(new Paragraph({ children: [text(b.caption, { bold: true, size: 20 })], spacing: { before: 120, after: 80 }, keepNext: true }));
      children.push(table(b.head, b.rows.map((cells) => ({ cells })), b.widths ?? b.head.map(() => 1)));
      children.push(new Paragraph({ children: [], spacing: { after: 160 } }));
    } else if (b.kind === "fields") {
      children.push(new Paragraph({ children: [text(b.title, { bold: true, size: 22 })], spacing: { before: 160, after: 80 }, keepNext: true }));
      children.push(table(null, b.rows.map((r) => ({ cells: [r.label, r.value], mono: [false, !!r.mono] })), [28, 72]));
      children.push(new Paragraph({ children: [], spacing: { after: 120 } }));
    }
  }

  return new Document({
    creator: "Meridian Research Studio",
    title: doc.title,
    description: doc.subtitle.join(". "),
    styles: {
      default: { document: { run: { font: BODY_FONT, size: 22 } } },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: BODY_FONT, size: 26, bold: true, color: "000000" },
          paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 0 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }],
        },
        {
          reference: "numbers",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 400 } } } }],
        },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: PAGE_WIDTH, height: PAGE_HEIGHT }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ font: BODY_FONT, size: 18, color: GREY, children: [`${doc.title}, page `, PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES] })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}
