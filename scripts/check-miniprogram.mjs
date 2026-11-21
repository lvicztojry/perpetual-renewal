import {readdirSync,readFileSync,mkdirSync,existsSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=path.resolve('miniprogram'),app=JSON.parse(readFileSync(path.join(root,'app.json')));
for(const page of app.pages)for(const ext of ['.js','.json','.wxml'])if(!existsSync(path.join(root,page+ext)))throw new Error('Missing page file '+page+ext);
const files=readdirSync(root,{recursive:true}).filter(f=>statSync(path.join(root,f)).isFile());
for(const file of files){if(file.endsWith('.js'))new vm.Script(readFileSync(path.join(root,file),'utf8'),{filename:file});if(file.endsWith('.json'))JSON.parse(readFileSync(path.join(root,file),'utf8'));}
for(const route of app.pages){
 let definition;
 const source=path.join(root,route+'.js'),loader=createRequire(source);
 vm.runInNewContext(readFileSync(source,'utf8'),{require:name=>name.endsWith('/runtime')?{page:value=>{definition=value;}}:loader(name)});
 const methods=new Set(['input','go','edit','run','api',...Object.keys(definition)]);
 for(const match of readFileSync(path.join(root,route+'.wxml'),'utf8').matchAll(/\bbind(?::\w+|\w+)="([A-Za-z_$][\w$]*)"/g))if(!methods.has(match[1]))throw new Error(route+' references missing handler '+match[1]);
}
const bytes=files.reduce((sum,f)=>sum+statSync(path.join(root,f)).size,0);
if(bytes>2*1024*1024)throw new Error('Main package exceeds 2 MiB');
const compilerRoot=process.env.WECHAT_COMPILER_ROOT || 'D:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec';
if(!existsSync(path.join(compilerRoot,'wcc.exe')))throw new Error('Set WECHAT_COMPILER_ROOT to the installed official compiler directory.');
const output=path.resolve('.tmp-miniprogram-qa');mkdirSync(output,{recursive:true});
for(const[compiler,ext]of [['wcc','.wxml'],['wcsc','.wxss']]){
 const args=['-o',path.join(output,compiler+'.js'),...files.filter(f=>f.endsWith(ext)).map(f=>'./'+f.replaceAll('\\','/'))];
 const result=spawnSync(path.join(compilerRoot,compiler+'.exe'),args,{cwd:root,encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw new Error(compiler+' failed: '+result.stderr+'\n'+result.stdout);
 console.log(compiler+' passed for '+files.filter(f=>f.endsWith(ext)).length+' files.');
}
console.log('Mini program JavaScript/JSON and official WXML/WXSS compiler checks passed; package '+Math.ceil(bytes/1024)+' KiB. Device runtime remains a separate check.');
