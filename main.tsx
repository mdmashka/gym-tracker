import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import type { AppData, Exercise, Screen, SetEntry, Workout, WorkoutExercise, WorkoutTypeId } from './types';
import { getAppData, isRemoteConfigured, saveRemoteData } from './api';
import { formatDate, formatLongDate, formatReps, formatWeight, getExercisesForType, latestTwoExecutions, startWorkout, todayISO, uid, workoutTypeName, csvEscape, buildExportRows, ensureWorkoutExercises } from './utils';
import { getTelegram, haptic, initTelegram } from './telegram';
import './styles.css';

function App(){
  const [data,setData]=useState<AppData|null>(null);
  const [screen,setScreen]=useState<Screen>({kind:'home'});
  const [timer,setTimer]=useState<{until:number}|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const workoutBack=useRef<()=>void>(()=>{});

  useEffect(()=>{ initTelegram(); getAppData().then(setData).catch(e=>setError(String(e))).finally(()=>setLoading(false)); },[]);
  useEffect(()=>{
    const tg=getTelegram(); if(!tg) return;
    const handler=()=>workoutBack.current();
    tg.BackButton.onClick(handler); return ()=>tg.BackButton.offClick(handler);
  },[]);
  useEffect(()=>{
    const tg=getTelegram(); if(!tg) return;
    const show=screen.kind!=='home';
    show?tg.BackButton.show():tg.BackButton.hide();
    workoutBack.current=()=>setScreen(screen.kind==='workout'||screen.kind==='history'||screen.kind==='settings'||screen.kind==='calendar'||screen.kind==='summary'?{kind:'home'}:{kind:'home'});
  },[screen]);

  const commit=async(next:AppData)=>{ setData(next); try{await saveRemoteData(next);}catch(e){setError(`Не удалось синхронизировать: ${String(e)}`);} };
  if(loading) return <div className="app"><div className="card">Загрузка…</div></div>;
  if(!data) return <div className="app"><div className="card"><h2>Не удалось открыть журнал</h2><p className="muted">{error}</p></div></div>;

  let body:React.ReactNode;
  if(screen.kind==='home') body=<Home data={data} onStart={typeId=>{
    const existing=data.workouts.find(w=>w.typeId===typeId&&w.date===todayISO()&&w.status==='draft');
    if(existing) setScreen({kind:'workout',typeId,workoutId:existing.id});
    else { const w=startWorkout(data,typeId); commit({...data,workouts:[...data.workouts,w]}).then(()=>setScreen({kind:'workout',typeId,workoutId:w.id})); }
  }} onNav={setScreen}/>;
  if(screen.kind==='workout') {
    const w0=data.workouts.find(w=>w.id===screen.workoutId);
    body=w0?<WorkoutScreen data={data} workout={ensureWorkoutExercises(w0,data)} onChange={w=>commit({...data,workouts:data.workouts.map(x=>x.id===w.id?w:x)})} onFinish={w=>commit({...data,workouts:data.workouts.map(x=>x.id===w.id?{...x,status:'completed',completedAt:new Date().toISOString()}:x)})} onTimer={(seconds)=>setTimer({until:Date.now()+seconds*1000})} onHome={()=>setScreen({kind:'home'})}/>:<NotFound/>;
  }
  if(screen.kind==='calendar') body=<CalendarScreen data={data} onOpen={w=>setScreen({kind:'history',workoutId:w.id})}/>;
  if(screen.kind==='history') { const w=data.workouts.find(x=>x.id===screen.workoutId); body=w?<HistoryScreen data={data} workout={w}/>:<NotFound/>; }
  if(screen.kind==='summary') body=<SummaryScreen data={data}/>;
  if(screen.kind==='settings') body=<SettingsScreen data={data} onChange={commit}/>;
  return <div className="app">{error && <div className="notice no-print">{error}</div>}{body}{timer && <RestTimer timer={timer} onClose={()=>setTimer(null)}/>}</div>;
}

function Top({title,sub}:{title:string;sub?:string}){ return <div className="topbar"><div><div className="eyebrow">GYM LOG</div><h1>{title}</h1>{sub&&<div className="muted" style={{marginTop:5}}>{sub}</div>}</div></div> }

function Home({data,onStart,onNav}:{data:AppData;onStart:(t:WorkoutTypeId)=>void;onNav:(s:Screen)=>void}){
 const today=todayISO();
 return <div className="screen">
  <Top title="Сегодня" sub={formatLongDate(today)}/>
  {data.workoutTypes.map(t=>{
    const last=data.workouts.filter(w=>w.typeId===t.id&&w.status==='completed').sort((a,b)=>b.date.localeCompare(a.date))[0];
    return <button className="card choice-card" key={t.id} onClick={()=>{haptic();onStart(t.id)}}><span className="meta"><span className="choice-title">{t.name}</span><span className="choice-sub">{last?`Последняя: ${formatDate(last.date)}`:'Пока нет тренировок'}</span></span><span className="chevron">›</span></button>
  })}
  <div className="tool-row">
    <button className="tool" onClick={()=>onNav({kind:'calendar'})}><strong>Календарь</strong><span>Все тренировки</span></button>
    <button className="tool" onClick={()=>onNav({kind:'summary'})}><strong>Сводка</strong><span>История по упражнениям</span></button>
    <button className="tool" onClick={()=>onNav({kind:'settings'})}><strong>Настройка</strong><span>Шаблоны и упражнения</span></button>
  </div>
  {isRemoteConfigured && <div className="muted" style={{fontSize:12,textAlign:'center'}}>Синхронизация включена</div>}
 </div>
}

function WorkoutScreen({data,workout,onChange,onFinish,onTimer,onHome}:{data:AppData;workout:Workout;onChange:(w:Workout)=>void;onFinish:(w:Workout)=>void;onTimer:(s:number)=>void;onHome:()=>void}){
 const [currentId,setCurrentId]=useState<string|null>(()=>workout.exercises.find(x=>!x.skipped&&x.sets.length===0)?.id ?? workout.exercises.find(x=>!x.skipped)?.id ?? null);
 const [showAdd,setShowAdd]=useState(false);
 const exercises=[...workout.exercises].sort((a,b)=>a.order-b.order);
 const updateWe=(id:string,patch:Partial<WorkoutExercise>)=>onChange({...workout,exercises:workout.exercises.map(x=>x.id===id?{...x,...patch}:x)});
 const addOneShot=(exercise:Exercise)=>{
   const max=Math.max(0,...workout.exercises.map(x=>x.order));
   const we:WorkoutExercise={id:uid(),exerciseId:exercise.id,order:max+1,skipped:false,sets:[]};
   onChange({...workout,exercises:[...workout.exercises,we]}); setCurrentId(we.id);
 };
 const move=(id:string,dir:-1|1)=>{
   const sorted=[...workout.exercises].sort((a,b)=>a.order-b.order); const i=sorted.findIndex(x=>x.id===id); const j=i+dir; if(i<0||j<0||j>=sorted.length)return;
   const tmp=sorted[i];sorted[i]=sorted[j];sorted[j]=tmp; onChange({...workout,exercises:sorted.map((x,idx)=>({...x,order:idx+1}))});
 };
 const skip=(id:string)=>{updateWe(id,{skipped:true}); if(currentId===id)setCurrentId(null);};
 const finish=()=>{haptic('success');onFinish(workout);onHome();};
 const typeName=workoutTypeName(data,workout.typeId);
 return <div className="screen">
  <Top title={typeName} sub={`${formatLongDate(workout.date)} · ${workout.status==='draft'?'в процессе':'завершено'}`}/>
  <div className="exercise-list">
   {exercises.map((we,idx)=>{
    const ex=data.exercises.find(e=>e.id===we.exerciseId); if(!ex)return null;
    const open=currentId===we.id;
    return <ExerciseCard key={we.id} data={data} workout={workout} we={we} ex={ex} open={open} setOpen={()=>setCurrentId(we.id)} onUpdate={p=>updateWe(we.id,p)} onMove={d=>move(we.id,d)} onSkip={()=>skip(we.id)} onTimer={onTimer} onClose={()=>setCurrentId(null)}/>;
   })}
  </div>
  <button className="secondary" onClick={()=>setShowAdd(true)}>+ Добавить упражнение</button>
  {showAdd && <div className="modal-backdrop" onClick={()=>setShowAdd(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>Добавить упражнение</h2><button className="icon-btn" onClick={()=>setShowAdd(false)}>×</button></div><div className="exercise-list">{data.exercises.filter(e=>e.isActive).map(e=><button className="card choice-card" key={e.id} disabled={workout.exercises.some(w=>w.exerciseId===e.id)} style={{opacity:workout.exercises.some(w=>w.exerciseId===e.id)?0.45:1}} onClick={()=>{if(workout.exercises.some(w=>w.exerciseId===e.id))return;addOneShot(e);setShowAdd(false);}}><span className="meta"><span className="choice-title">{e.name}</span><span className="choice-sub">{workoutTypeName(data,e.workoutTypeId)}</span></span><span className="chevron">›</span></button>)}</div></div></div>}
  <div className="workout-finish-bar"><button className="primary workout-finish-button" onClick={finish}>Завершить тренировку</button></div>
 </div>
}

function ExerciseCard({data,workout,we,ex,open,setOpen,onUpdate,onMove,onSkip,onTimer,onClose}:{data:AppData;workout:Workout;we:WorkoutExercise;ex:Exercise;open:boolean;setOpen:()=>void;onUpdate:(p:Partial<WorkoutExercise>)=>void;onMove:(d:-1|1)=>void;onSkip:()=>void;onTimer:(s:number)=>void;onClose:()=>void}){
 const [weight,setWeight]=useState<string>(()=>{const prev=we.sets[we.sets.length-1]?.weight;return prev==null?'':String(prev)});
 const [reps,setReps]=useState<string>('');
 const [comment,setComment]=useState('');
 const hist=latestTwoExecutions(data,workout.typeId,ex.id);
 useEffect(()=>{const prev=we.sets[we.sets.length-1]?.weight;if(prev!=null)setWeight(String(prev));},[we.sets.length]);
 const saveSet=()=>{
   const w=weight.trim()===''?null:Number(weight.replace(',','.'));
   const r=reps.trim()===''?null:Number(reps.replace(',','.'));
   if(r===null || Number.isNaN(r)){ haptic('error'); return; }
   const s:SetEntry={id:uid(),order:we.sets.length+1,weight:w,reps:r,comment:comment.trim()||undefined};
   onUpdate({sets:[...we.sets,s]}); setReps(''); setComment(''); haptic(); onTimer(data.settings?.restTimerSeconds ?? 120);
 };
 const previousSet=we.sets.length>0?we.sets[we.sets.length-1]:null;
 const copyLast=()=>{if(!previousSet){haptic('error');return;}setWeight(previousSet.weight==null?'':String(previousSet.weight));setReps(previousSet.reps==null?'':String(previousSet.reps));setComment(previousSet.comment??'');haptic();};
 return <div className="card exercise-card">
  <div className="exercise-head"><button style={{background:'transparent',color:'inherit',padding:0,textAlign:'left',cursor:'pointer'}} onClick={setOpen}><div className="exercise-name">{ex.name}</div><div className="muted" style={{fontSize:12,marginTop:3}}>{we.skipped?'Пропущено':`${we.sets.length} подходов`}</div></button>
    <div className="exercise-actions"><button className="icon-btn" title="выше" onClick={()=>onMove(-1)}>↑</button><button className="icon-btn" title="ниже" onClick={()=>onMove(1)}>↓</button><button className="icon-btn" title="пропустить" onClick={onSkip}>×</button></div>
  </div>
  {hist.length>0 && <div className="history-strip"><div className="history-date">Последние тренировки</div>{hist.map(h=><div key={h.workout.id} style={{marginBottom:4}}><strong style={{fontSize:13}}>{formatDate(h.workout.date)}</strong> <span className="muted" style={{fontSize:12}}>·</span> <span style={{fontSize:13}}>{h.workoutExercise.sets.map(s=>`${formatWeight(s.weight)}×${formatReps(s.reps)}`).join(' · ')}</span></div>)}</div>}
  {open && !we.skipped && <>
    <div style={{marginTop:8}}>{we.sets.map(s=><div className="set-line" key={s.id}><span className="set-num">{s.order}</span><span>{formatWeight(s.weight)} кг</span><span>{formatReps(s.reps)} повт.</span><button className="icon-btn" onClick={()=>onUpdate({sets:we.sets.filter(x=>x.id!==s.id).map((x,i)=>({...x,order:i+1}))})}>×</button></div>)}</div>
    <div className="set-line" style={{borderTop:we.sets.length?'1px solid rgba(128,128,128,.11)':'0'}}><span className="set-num">{we.sets.length+1}</span><input className="input" inputMode="decimal" placeholder="Вес" value={weight} onChange={e=>setWeight(e.target.value)}/><input className="input" inputMode="numeric" placeholder="Повторы" value={reps} onChange={e=>setReps(e.target.value)}/><button className="icon-btn" onClick={saveSet}>✓</button></div>
    <div className="set-actions"><button className="secondary" onClick={copyLast} disabled={!previousSet}>Скопировать</button><button className="secondary" onClick={()=>saveSet()}>+ Подход</button></div>
    <textarea className="input comment-input notes" placeholder="Комментарий к следующему подходу (необязательно)" value={comment} onChange={e=>setComment(e.target.value)}/>
    {we.notes && <div className="history-empty">Импортированная заметка: {we.notes}</div>}
    <button className="primary" style={{marginTop:10,width:'100%'}} onClick={onClose}>Готово</button>
  </>}
 </div>
}

function RestTimer({timer,onClose}:{timer:{until:number};onClose:()=>void}){
 const [until,setUntil]=useState(timer.until);
 const [left,setLeft]=useState(Math.max(0,timer.until-Date.now()));
 useEffect(()=>{const id=setInterval(()=>{const n=Math.max(0,until-Date.now());setLeft(n);if(n===0){clearInterval(id);haptic('success');}},250);return()=>clearInterval(id)},[until]);
 return <div className="timer-fab"><div><div className="eyebrow">ОТДЫХ</div><div className="timer-time">{String(Math.floor(left/60000)).padStart(2,'0')}:{String(Math.floor((left%60000)/1000)).padStart(2,'0')}</div></div><div className="timer-controls"><button className="timer-btn" onClick={()=>{const n=until+30000;setUntil(n);setLeft(n-Date.now());}}>+30</button><button className="timer-btn" onClick={()=>{const n=Math.max(Date.now(),until-30000);setUntil(n);setLeft(n-Date.now());}}>−30</button><button className="timer-btn" onClick={onClose}>Готово</button></div></div>
}

function CalendarScreen({data,onOpen}:{data:AppData;onOpen:(w:Workout)=>void}){
 const [month,setMonth]=useState(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1)});
 const y=month.getFullYear(),m=month.getMonth(); const first=new Date(y,m,1); const start=(first.getDay()+6)%7; const days=new Date(y,m+1,0).getDate();
 const byDate=new Map(data.workouts.filter(w=>w.status==='completed').map(w=>[w.date,w]));
 const cells=[]; for(let i=0;i<start;i++)cells.push(<div key={'p'+i}/>); for(let d=1;d<=days;d++){const date=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const w=byDate.get(date);cells.push(<button key={date} className={`cal-day ${date===todayISO()?'today':''}`} onClick={()=>w&&onOpen(w)}>{d}{w&&<span className="cal-dot"/>}</button>)}
 return <div className="screen"><Top title="Календарь"/><div className="card"><div className="calendar-head"><button className="secondary" onClick={()=>setMonth(new Date(y,m-1,1))}>‹</button><strong>{month.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</strong><button className="secondary" onClick={()=>setMonth(new Date(y,m+1,1))}>›</button></div><div className="month-grid" style={{marginTop:12}}>{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(x=><div className="cal-day-name" key={x}>{x}</div>)}{cells}</div></div></div>
}

function HistoryScreen({data,workout}:{data:AppData;workout:Workout}){ return <div className="screen"><Top title={workoutTypeName(data,workout.typeId)} sub={formatLongDate(workout.date)}/>{[...workout.exercises].sort((a,b)=>a.order-b.order).map(we=>{const ex=data.exercises.find(e=>e.id===we.exerciseId);if(!ex)return null;return <div className="card" key={we.id}><div className="exercise-name">{ex.name}</div>{we.skipped?<div className="muted" style={{marginTop:6}}>Пропущено</div>:we.sets.map(s=><div key={s.id} className="summary-row"><span>Подход {s.order}</span><span className="summary-result">{formatWeight(s.weight)} кг × {formatReps(s.reps)}</span></div>)}{we.notes&&<div className="history-empty">{we.notes}</div>}</div>})}</div> }

function SummaryScreen({data}:{data:AppData}){
 const [type,setType]=useState<WorkoutTypeId>(data.workoutTypes[0].id);
 const [exercise,setExercise]=useState<string>('all');
 const exercises=getExercisesForType(data,type);
 const rows=useMemo(()=>{const out:Array<{date:string;exercise:string;result:string}> = [];const relevant=data.workouts.filter(w=>w.typeId===type&&w.status==='completed').sort((a,b)=>b.date.localeCompare(a.date));for(const w of relevant)for(const we of w.exercises){const ex=data.exercises.find(e=>e.id===we.exerciseId);if(!ex||we.skipped||!we.sets.length|| (exercise!=='all'&&ex.id!==exercise))continue;out.push({date:w.date,exercise:ex.name,result:we.sets.map(s=>`${formatWeight(s.weight)}×${formatReps(s.reps)}`).join(' · ')});}return out;},[data,type,exercise]);
 const print=()=>window.print();
 const exportCsv=()=>{const rows=buildExportRows(data).map(r=>r.map(csvEscape).join(';')).join('\n');const bom='\uFEFF';downloadText(`gym-log-${todayISO()}.csv`,bom+rows,'text/csv;charset=utf-8');};
 const exportXlsx=()=>{const rows=buildExportRows(data);const ws=XLSX.utils.aoa_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Тренировки');XLSX.writeFile(wb,`gym-log-${todayISO()}.xlsx`);};
 return <div className="screen"><Top title="Сводка"/><div className="card"><div className="segmented">{data.workoutTypes.map(t=><button key={t.id} className={type===t.id?'active':''} onClick={()=>{setType(t.id);setExercise('all')}}>{t.name.replace(' + ',' +\n')}</button>)}</div><select className="input" style={{marginTop:10}} value={exercise} onChange={e=>setExercise(e.target.value)}><option value="all">Все упражнения</option>{exercises.map(e=><option value={e.id} key={e.id}>{e.name}</option>)}</select></div>{rows.length===0?<div className="card muted">Нет сохранённых данных.</div>:<div className="summary-group">{rows.map((r,i)=><div className="card summary-row" key={i}><div className="summary-main"><div className="summary-name">{r.exercise}</div><div className="muted" style={{fontSize:12,marginTop:3}}>{formatDate(r.date)}</div></div><div className="summary-result">{r.result}</div></div>)}</div>}<div className="tool-row no-print"><button className="tool" onClick={exportXlsx}><strong>Excel</strong><span>Выгрузить .xlsx</span></button><button className="tool" onClick={print}><strong>PDF</strong><span>Печать / сохранить PDF</span></button><div/></div></div>
}

function SettingsScreen({data,onChange}:{data:AppData;onChange:(d:AppData)=>Promise<void>|void}){
 const [addName,setAddName]=useState(''); const [target,setTarget]=useState<WorkoutTypeId>(data.workoutTypes[0].id);
 const exercises=getExercisesForType(data,target);
 const restTimerSeconds=data.settings?.restTimerSeconds ?? 120;
 const setRestTimer=(seconds:number)=>onChange({...data,settings:{...data.settings,restTimerSeconds:seconds}});
 const add=()=>{const name=addName.trim();if(!name)return;const id=uid();const max=Math.max(0,...data.exercises.filter(e=>e.workoutTypeId===target).map(e=>e.sortOrder));const ex:Exercise={id,name,workoutTypeId:target,loadType:'weight',sortOrder:max+1,isActive:true};onChange({...data,exercises:[...data.exercises,ex]});setAddName('');};
 const move=(ex:Exercise,dir:-1|1)=>{const arr=data.exercises.filter(e=>e.workoutTypeId===target&&e.isActive).sort((a,b)=>a.sortOrder-b.sortOrder);const i=arr.findIndex(x=>x.id===ex.id),j=i+dir;if(i<0||j<0||j>=arr.length)return;[arr[i],arr[j]]=[arr[j],arr[i]];const map=new Map(arr.map((x,idx)=>[x.id,idx+1]));onChange({...data,exercises:data.exercises.map(x=>map.has(x.id)?{...x,sortOrder:map.get(x.id)!}:x)});};
 return <div className="screen"><Top title="Настройки" sub="Тренировки и приложение"/>
  <div className="card"><div className="exercise-name">Таймер отдыха</div><div className="settings-item" style={{marginTop:8}}><div><div>После сохранения подхода</div><div className="muted" style={{fontSize:12,marginTop:3}}>Стандартная длительность таймера</div></div><select className="input" style={{width:110,minHeight:40}} value={restTimerSeconds} onChange={e=>setRestTimer(Number(e.target.value))}>{Array.from({length:20},(_,i)=>(i+1)*30).map(s=><option key={s} value={s}>{Math.floor(s/60)}:{String(s%60).padStart(2,'0')}</option>)}</select></div></div>
  <div className="card"><div className="segmented">{data.workoutTypes.map(t=><button key={t.id} className={target===t.id?'active':''} onClick={()=>setTarget(t.id)}>{t.name}</button>)}</div><div style={{marginTop:8}}>{exercises.map(ex=><div className="settings-item" key={ex.id}><span>{ex.name}</span><span style={{display:'flex',gap:5}}><button className="icon-btn" onClick={()=>move(ex,-1)}>↑</button><button className="icon-btn" onClick={()=>move(ex,1)}>↓</button></span></div>)}</div></div><div className="card"><div className="exercise-name">Добавить упражнение</div><div className="form-grid" style={{marginTop:10}}><input className="input" value={addName} onChange={e=>setAddName(e.target.value)} placeholder="Название упражнения"/><button className="primary" onClick={add}>Добавить в шаблон</button></div><div className="muted" style={{fontSize:12,marginTop:8}}>Разовое добавление во время тренировки остаётся доступно отдельно.</div></div></div>
}
function NotFound(){return <div className="card">Не найдено.</div>}

function downloadText(filename:string, content:string, type='text/plain;charset=utf-8') { const blob=new Blob([content],{type}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }

createRoot(document.getElementById('root')!).render(<App/>);
