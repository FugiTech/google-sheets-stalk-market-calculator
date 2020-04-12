const { readFileSync, writeFileSync } = require('fs');
const ts2gas = require('ts2gas');

let source = readFileSync('Code.ts').toString();
let transpiled = ts2gas(source);

writeFileSync('build/Code.js', transpiled);
