import {inflateRawSync} from 'node:zlib';

const signature = {local:0x04034b50, central:0x02014b50, end:0x06054b50};
const table = Array.from({length:256}, (_, n) => {
  for (let i=0;i<8;i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function assertSafeEntry(name) {
  if (!name || name.includes('\\') || name.startsWith('/') || name.includes(':') ||
      name.split('/').some(part => part === '..' || part === '.')) throw new Error('Unsafe archive path.');
  for (const part of name.toLowerCase().split('/')) {
    if ((part.startsWith('.env') && part !== '.env.example') ||
        ['.git','.next','.local','node_modules','test-results','playwright-report'].includes(part) || part.startsWith('audit-') ||
        /(?:^|[._-])(?:credentials|secrets|storage-state|auth-state)(?:[._-]|$)/.test(part) ||
        /\.e2e-state|\.env\.local|\.(?:pem|key|p12|pfx|zip|dump|bak)$/.test(part)) {
      throw new Error('Private or generated file rejected from release archive: ' + name);
    }
  }
}
function assertSafeContent(name, data) {
  if (!/\.(?:ts|tsx|js|mjs|json|md|txt|sql|toml|yml|yaml)$|\.env\.example$/.test(name)) return;
  const text = data.toString('utf8');
  // Specific credential formats only; public Supabase keys and references to
  // process.env are not secrets. Never include a matched value in diagnostics.
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) ||
      /\b(?:sk-ant-api\d+-|nvapi-|ghp_|github_pat_)[A-Za-z0-9_-]{20,}/.test(text)) {
    throw new Error('Possible private credential content rejected: ' + name);
  }
}
export function createSourceArchive(entries, forbiddenValues = []) {
  const locals=[],centrals=[]; let offset=0;
  if (!entries.length) throw new Error('An empty release archive is not valid.');
  if (entries.length > 65535) throw new Error('Too many release files.');
  const seen=new Set();
  for (const {name,data} of entries) {
    assertSafeEntry(name);
    if (seen.has(name.toLowerCase())) throw new Error('Duplicate archive path.');
    seen.add(name.toLowerCase());
    if (forbiddenValues.some(value => value.length >= 12 && Buffer.from(data).includes(Buffer.from(value)))) throw new Error('A known private credential was rejected from: ' + name);
    assertSafeContent(name,data);
    const bytes=Buffer.from(data), filename=Buffer.from(name), crc=crc32(bytes);
    if (bytes.length>20*1024*1024) throw new Error('Release entry exceeds size limit: '+name);
    const header=Buffer.alloc(30);header.writeUInt32LE(signature.local);header.writeUInt16LE(20,4);
    header.writeUInt16LE(0x800,6);header.writeUInt32LE(crc,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(filename.length,26);
    locals.push(header,filename,bytes);
    const central=Buffer.alloc(46);central.writeUInt32LE(signature.central);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);
    central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    centrals.push(central,filename);offset+=header.length+filename.length+bytes.length;
  }
  const directory=Buffer.concat(centrals),end=Buffer.alloc(22);
  end.writeUInt32LE(signature.end);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
export function inspectSourceArchive(archive) {
  // This release format intentionally excludes ZIP64, encryption and split
  // archives. Validate local and central names, bytes, CRC and bounded sizes.
  const end=archive.length-22;
  if(end<0||archive.readUInt32LE(end)!==signature.end||archive.readUInt16LE(end+20)!==0)throw new Error('Unsupported or malformed release ZIP.');
  const count=archive.readUInt16LE(end+10),start=archive.readUInt32LE(end+16),size=archive.readUInt32LE(end+12);
  if(!count)throw new Error('An empty release archive is not valid.');
  if(archive.readUInt32LE(end+4)!==0||archive.readUInt16LE(end+8)!==count||start+size!==end)throw new Error('Invalid ZIP directory.');
  let offset=start,total=0;const names=[],seen=new Set();
  for(let i=0;i<count;i++){
    if(offset+46>end||archive.readUInt32LE(offset)!==signature.central)throw new Error('Malformed ZIP entry.');
    const flags=archive.readUInt16LE(offset+8),method=archive.readUInt16LE(offset+10),packed=archive.readUInt32LE(offset+20),unpacked=archive.readUInt32LE(offset+24);
    const len=archive.readUInt16LE(offset+28),extra=archive.readUInt16LE(offset+30),comment=archive.readUInt16LE(offset+32),local=archive.readUInt32LE(offset+42);
    if(offset+46+len+extra+comment>end||(flags&9)||![0,8].includes(method)||unpacked>20*1024*1024||(total+=unpacked)>80*1024*1024)throw new Error('Unsupported ZIP entry.');
    const name=archive.subarray(offset+46,offset+46+len).toString('utf8');assertSafeEntry(name);
    if(seen.has(name.toLowerCase()))throw new Error('Duplicate ZIP entry.');seen.add(name.toLowerCase());
    if(local+30>start||archive.readUInt32LE(local)!==signature.local)throw new Error('Missing local ZIP header.');
    const localLen=archive.readUInt16LE(local+26),localExtra=archive.readUInt16LE(local+28),dataStart=local+30+localLen+localExtra;
    if(dataStart+packed>start||archive.subarray(local+30,local+30+localLen).toString('utf8')!==name||archive.readUInt16LE(local+8)!==method)throw new Error('ZIP header mismatch.');
    const bytes=archive.subarray(dataStart,dataStart+packed),data=method===0?bytes:inflateRawSync(bytes,{maxOutputLength:20*1024*1024});
    if(data.length!==unpacked||crc32(data)!==archive.readUInt32LE(offset+16))throw new Error('ZIP content mismatch.');
    assertSafeContent(name,data);names.push(name);offset+=46+len+extra+comment;
  }
  if(offset!==end)throw new Error('ZIP directory has trailing data.');
  return names;
}
