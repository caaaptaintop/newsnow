import { DatabaseSync } from "node:sqlite"
import type { BuildingDB,Statement } from "../../server/building/store"
export function memoryBuildingDB(){
  const sqlite=new DatabaseSync(":memory:")
  const statement=(sql:string,values:any[]=[]):Statement=>({
    bind:(...values:any[])=>statement(sql,values),
    first:async(column?:string)=>{const row=sqlite.prepare(sql).get(...values) as any;return row?column?row[column]:row:null},
    all:async()=>({results:sqlite.prepare(sql).all(...values) as any[]}),run:async()=>sqlite.prepare(sql).run(...values),...{sql,values},
  })
  const db:BuildingDB={prepare:statement,batch:async(statements:Statement[])=>{
    sqlite.exec("BEGIN")
    try{const result=statements.map((s:any)=>({results:sqlite.prepare(s.sql).all(...s.values) as any[]}));sqlite.exec("COMMIT");return result}catch(error){sqlite.exec("ROLLBACK");throw error}
  }}
  return{db,sqlite}
}
