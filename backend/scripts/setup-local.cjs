const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const target=path.join(__dirname,'../.env');
if(fs.existsSync(target)){console.log('.env already exists; left unchanged.');process.exit(0);}
const password=crypto.randomBytes(24).toString('hex'),secret=crypto.randomBytes(48).toString('hex');
let text=fs.readFileSync(path.join(__dirname,'../.env.example'),'utf8');
text=text.replace('AUTH_SECRET=replace-with-at-least-32-random-characters','AUTH_SECRET='+secret).replaceAll('replace-password',password);
fs.writeFileSync(target,text,{mode:0o600,flag:'wx'});console.log('Created local .env with random secrets.');
