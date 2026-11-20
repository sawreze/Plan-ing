import 'dotenv/config';
import { makeApp } from './server';
async function main(){if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');const app=await makeApp();await app.listen(Number(process.env.PORT||8080),process.env.HOST||'127.0.0.1');}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
