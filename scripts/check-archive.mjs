import {readFile} from 'node:fs/promises';
import {inspectSourceArchive} from './release-archive.mjs';
const file=process.argv[2]??'release/nudge-source.zip';
try{const names=inspectSourceArchive(await readFile(file));console.log('Archive passed: '+names.length+' safe entries.');}
catch(error){console.error('Archive rejected: '+error.message);process.exitCode=1;}
