'use strict';
// Offline smoke checks for three HTML screens. Not browser E2E.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const files=['student.html','librarian.html','kiosk.html'];
for(const file of files){
 test(`SMOKE - ${file} tồn tại và có HTML hợp lệ ở mức tối thiểu`,()=>{
  const p=path.join(root,file);
  assert.ok(fs.existsSync(p),`Thiếu ${file} tại thư mục gốc. Chỉ sao chép thư mục test vào dự án đã có 3 file HTML.`);
  const content=fs.readFileSync(p,'utf8');
  assert.match(content,/<html\b/i);assert.match(content,/<body\b/i);assert.match(content,/<script\b/i);
 });
}
