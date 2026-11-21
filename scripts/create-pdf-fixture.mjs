import { writeFile } from 'node:fs/promises';
const lines = [
  'QIYE PDF acceptance fixture',
  'Abstract',
  'This is an original test document, not a published research paper.',
  'Reading a research paper requires careful attention to the evidence.',
  'The result does not prove that the treatment is effective for everyone.',
  'Methods',
  'We compare 12 observations and report a confidence interval of 95 percent.',
];
const content = 'BT /F1 14 Tf 60 770 Td 24 TL\n' + lines.map((line, i) => `${i ? 'T* ' : ''}(${line}) Tj`).join('\n') + '\nET';
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
];
let pdf = '%PDF-1.4\n'; const offsets = [0];
for (let i=0;i<objects.length;i++){ offsets.push(Buffer.byteLength(pdf)); pdf += `${i+1} 0 obj\n${objects[i]}\nendobj\n`; }
const xref=Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await writeFile(new URL('../tests/reading-fixture.pdf',import.meta.url),pdf);
console.log('Created original one-page PDF fixture.');
