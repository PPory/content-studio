import { loadEnv } from 'vite';
import Database from 'better-sqlite3';
import { createAcquisitionRecoveryPoint, inspectAcquisitionBaseline, resetAcquisitionBaseline, writeBaselineResetReport } from '../server/acquisition/baseline-reset.mjs';
import { openWorkspace } from '../server/storage/workspace.mjs';
import { resolveWorkspacePaths, runtimeXenhoHome } from '../server/storage/workspace-paths.mjs';

const flag=process.argv[2];if(!['--dry-run','--confirmed'].includes(flag)||process.argv.length!==3)throw new Error('Usage: node scripts/reset-acquisition-baseline.mjs --dry-run | --confirmed');
const env={...loadEnv('development',process.cwd(),''),...process.env},paths=resolveWorkspacePaths({xenhoHome:runtimeXenhoHome(env)}),stamp=new Date().toISOString().replace(/[:.]/g,'-');
if(flag==='--dry-run'){
  const db=new Database(paths.databaseFile,{readonly:true,fileMustExist:true});let report;try{db.pragma('query_only=ON');report=inspectAcquisitionBaseline(db);}finally{db.close();}
  const reportFile=await writeBaselineResetReport(paths,`baseline-reset-dry-run-${stamp}.json`,report);console.log(JSON.stringify({...report,reportFile},null,2));
}else{
  const previewDb=new Database(paths.databaseFile,{readonly:true,fileMustExist:true});let preview;try{preview=inspectAcquisitionBaseline(previewDb);}finally{previewDb.close();}if(preview.acquisition.activeJobs)throw new Error('仍有 acquisition 任务活动，先停止后再 reset');
  const backup=await createAcquisitionRecoveryPoint(paths);console.log(JSON.stringify({stage:'recovery_point_created',backup,preview},null,2));const workspace=await openWorkspace({xenhoHome:paths.root});let result;try{result=resetAcquisitionBaseline(workspace);}finally{workspace.close();}
  const report={confirmed:true,completedAt:new Date().toISOString(),backup,result};const reportFile=await writeBaselineResetReport(paths,`baseline-reset-confirmed-${stamp}.json`,report);console.log(JSON.stringify({...report,reportFile},null,2));
}
