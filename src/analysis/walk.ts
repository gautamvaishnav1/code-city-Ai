import {promises as fs} from 'node:fs'
import * as path from "node:path"

const CODE_EXTENSION = new Set([
    '.js','.jsx','.ts','.tsx','.cjs','.mjs','.ejs'
])

const SKIP_DIRS = new Set([
    'dist','node_modules','.git','build','coverage','.next','.cache','out','vendor','.turbo'
])

const SKIP_FILES = [
 /\.min\.js$/,   
  /\.bundle\.js$/,  
  /\.d\.ts$/,   ]

export async function walkCodeFiles(root:string):Promise<string[]>{
    const found:string[]=[];
    async function visit(dir:string):Promise<void> {
        let entries
        try {
            entries = await fs.readdir(dir,{withFileTypes:true})
        } catch (error) {
            return
        }
        for(const entry of entries){
            const full = path.join(dir,entry.name);
            if(entry.isDirectory()){
                if(SKIP_DIRS.has(entry.name)) continue;
                await visit(full);
                continue;
            }
            if(!entry.isFile())continue;
            if(!CODE_EXTENSION.has(path.extname(entry.name)))continue;
            if(SKIP_FILES.some((rtx)=>rtx.test(entry.name))) continue;
            found.push(full)
        }
    }
    await visit(root);

    return found.sort()
}  