import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import type { AppData, Exercise, Screen, SetEntry, Workout, WorkoutExercise, WorkoutTypeId } from './types';
import { getAppData, isRemoteConfigured, saveRemoteData } from './api';
import { formatDate, formatLongDate, formatReps, formatWeight, getExercisesForType, latestTwoExecutions, lastExecution, startWorkout, todayISO, uid, workoutTypeName, csvEscape, buildExportRows, ensureWorkoutExercises, downloadText } from './utils';
import { getTelegram, haptic, initTelegram } from './telegram';
import './styles.css';

function App(){
  const [data,setData]=useState<AppData|null>(null);
  const [screen,setScreen]=useState<Screen>({kind:'home'});
  const [timer,setTimer]=useState<{until:number}|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const workoutBack=useRef<()=>void>(()=>{});
  const syncQueue=useRef<Promise<void>>(Promise.resolve());

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

  const commit=(next:AppData):Promise<void>=>{
    setData(next);
    // Keep remote writes in the same order as local changes. A quick sequence
    // of saved sets must never be reordered by slower network responses.
    syncQueue.current=syncQueue.current
      .catch(()=>undefined)
      .then(()=>saveRemoteData(next))
      .then(()=>undefined)
      .catch(e=>{ setError(`Не удалось синхронизировать: ${String(e)}`); });
    return syncQueue.current;
  };
  if(loading) return <div className="app"><div className="card">Загрузка…</div></div>;
  if(!data) return <div className="app"><div className="card"><h2>Не удалось открыть журнал</h2><p className="muted">{error}</p></div></div>;

  let body:React.ReactNode;
  if(screen.kind==='home') body=<Home data={data} onStart={typeId=>{
    const existing=data.workouts.find(w=>w.typeId===typeId&&w.date===todayISO()&&w.status==='draft');
    if(existing) {
      const ensured=ensureWorkoutExercises(existing,data);
      if(ensured!==existing) commit({...data,workouts:data.workouts.map(w=>w.id===existing.id?ensured:w)});
      setScreen({kind:'workout',typeId,workoutId:existing.id});
    } else {
      const w=startWorkout(data,typeId);
      commit({...data,workouts:[...data.workouts,w]}).then(()=>setScreen({kind:'workout',typeId,workoutId:w.id}));
    }
  }} onNav={setScreen}/>;
  if(screen.kind==='workout') {
    const w0=data.workouts.find(w=>w.id===screen.workoutId);
    body=w0?<WorkoutScreen data={data} workout={w0} editing={screen.mode==='edit'} onChange={w=>commit({...data,workouts:data.workouts.map(x=>x.id===w.id?w:x)})} onFinish={w=>commit({...data,workouts:data.workouts.map(x=>x.id===w.id?{...x,status:'completed',completedAt:new Date().toISOString()}:x)})} onTimer={(seconds)=>setTimer({until:Date.now()+seconds*1000})} onHome={()=>setScreen({kind:'home'})}/>:<NotFound/>;
  }
  if(screen.kind==='calendar') body=<CalendarScreen data={data} onOpen={w=>setScreen({kind:'history',workoutId:w.id})}/>;
  if(screen.kind==='history') { const w=data.workouts.find(x=>x.id===screen.workoutId); body=w?<HistoryScreen data={data} workout={w} onEdit={()=>setScreen({kind:'workout',typeId:w.typeId,workoutId:w.id,mode:'edit'})} onDuplicate={()=>{const copy={...w,id:uid(),date:todayISO(),status:'draft',createdAt:new Date().toISOString(),completedAt:undefined,name:w.name};commit({...data,workouts:[...data.workouts,copy]}).then(()=>setScreen({kind:'workout',typeId:copy.typeId,workoutId:copy.id}));}}/>:<NotFound/>; }
  if(screen.kind==='summary') body=<SummaryScreen data={data}/>;
  if(screen.kind==='settings') body=<SettingsScreen data={data} onChange={commit}/>;
  return <div className="app">{error && <div className="notice no-print">{error}</div>}{body}{timer && <RestTimer timer={timer} onClose={()=>setTimer(null)}/>}</div>;
}

function Top({title,sub,action}:{title:string;sub?:string;action?:React.ReactNode}){ return <div className="topbar"><div><div className="eyebrow">GYM LOG</div><h1>{title}</h1>{sub&&<div className="muted" style={{marginTop:5}}>{sub}</div>}</div>{action}</div> }

function AppIcon({kind}:{kind:'legs'|'arms'|'back'|'calendar'|'chart'|'settings'}){
 const paths={legs:'M12 3v7m0 0 4 4m-4-4-4 4m4-4v8m0 0-3 3m3-3 3 3',arms:'M8 19v-6l-2-2 2-5 3 3 3-3 2 5-2 2v6',back:'M8 4v6m8-6v6M8 10l-3 3m11-3 3 3M12 4v16',calendar:'M6 3v3m12-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',chart:'M5 19V9m7 10V5m7 14v-7',settings:'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 9v2m0 5v-2m9-7h-2m-12 0H5m13.36-6.36-1.42 1.42M7.06 16.94l-1.42 1.42m12.72 0-1.42-1.42M7.06 7.06 5.64 5.64'};
 return <span className={'app-icon app-icon-'+kind} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]}/></svg></span>
}

function Home({data,onStart,onNav}:{data:AppData;onStart:(t:WorkoutTypeId)=>void;onNav:(s:Screen)=>void}){
 const today=todayISO();
 const icons:Record<WorkoutTypeId,'legs'|'arms'|'back'>={legs:'legs',arms:'arms',back_shoulders:'back'};
 return <div className="screen">
  <Top title="Сегодня" sub={formatLongDate(today)}/>
  <div className="home-section-label">ТРЕНИРОВКА</div>
  {data.workoutTypes.map(t=>{
    const last=data.workouts.filter(w=>w.typeId===t.id&&w.status==='completed').sort((a,b)=>b.date.localeCompare(a.date))[0];
    return <button className="card choice-card" key={t.id} onClick={()=>{haptic();onStart(t.id)}}><AppIcon kind={icons[t.id]}/><span className="meta"><span className="choice-title">{t.name}</span><span className="choice-sub">{last?'Последняя: '+formatDate(last.date):'Пока нет тренировок'}</span></span><span className="chevron">›</span></button>
  })}
  <div className="home-section-label">ЖУРНАЛ</div>
  <div className="tool-row">
    <button className="tool" onClick={()=>onNav({kind:'calendar'})}><AppIcon kind="calendar"/><span><strong>Календарь</strong><small>Все тренировки</small></span></button>
    <button className="tool" onClick={()=>onNav({kind:'summary'})}><AppIcon kind="chart"/><span><strong>Сводка</strong><small>Прогресс</small></span></button>
    <button className="tool" onClick={()=>onNav({kind:'settings'})}><AppIcon kind="settings"/><span><strong>Настройки</strong><small>Упражнения</small></span></button>
  </div>
  {isRemoteConfigured && <div className="muted sync-status">Синхронизация включена</div>}
 </div>
}
function WorkoutScreen({data,workout,editing,onChange,onFinish,onTimer,onHome}:{data:AppData;workout:Workout;editing?:boolean;onChange:(w:Workout)=>void;onFinish:(w:Workout)=>void;onTimer:(s:number)=>void;onHome:()=>void}){
 const [currentId,setCurrentId]=useState<string|null>(()=>workout.exercises.find(x=>!x.skipped&&x.sets.length===0)?.id ?? workout.exercises.find(x=>!x.skipped)?.id ?? null);
 const [showAdd,setShowAdd]=useState(false);
 const [showMeta,setShowMeta]=useState(false);
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
 const removeExercise=(id:string)=>{onChange({...workout,exercises:workout.exercises.filter(x=>x.id!==id)}); if(currentId===id)setCurrentId(null);};
 const finish=()=>{haptic('success');onFinish(workout);onHome();};
 const saveEdit=()=>{haptic('success');onChange({...workout,status:'completed',completedAt:workout.completedAt??new Date().toISOString()});onHome();};
 const typeName=workoutTypeName(data,workout.typeId);
 return <div className="screen">
  <Top title={workout.name || typeName} sub={`${formatLongDate(workout.date)} · ${workout.status==='draft'?'в процессе':'завершено'}`} action={<button className="top-action" onClick={()=>setShowMeta(true)}>•••</button>}/>
  <div className="exercise-list">
   {exercises.map((we,idx)=>{
    const ex=data.exercises.find(e=>e.id===we.exerciseId); if(!ex)return null;
    const open=currentId===we.id;
    return <ExerciseCard key={we.id} data={data} workout={workout} we={we} ex={ex} open={open} setOpen={()=>setCurrentId(we.id)} onUpdate={p=>updateWe(we.id,p)} onMove={d=>move(we.id,d)} onSkip={()=>skip(we.id)} onDelete={()=>removeExercise(we.id)} onTimer={onTimer} onClose={()=>setCurrentId(null)}/>;
   })}
  </div>
  <button className="secondary" onClick={()=>setShowAdd(true)}>+ Добавить упражнение</button>
  {showAdd && <div className="modal-backdrop" onClick={()=>setShowAdd(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>Добавить упражнение</h2><button className="icon-btn" onClick={()=>setShowAdd(false)}>×</button></div><div className="exercise-list">{data.exercises.filter(e=>e.isActive).map(e=><button className="card choice-card" key={e.id} disabled={workout.exercises.some(w=>w.exerciseId===e.id)} style={{opacity:workout.exercises.some(w=>w.exerciseId===e.id)?0.45:1}} onClick={()=>{if(workout.exercises.some(w=>w.exerciseId===e.id))return;addOneShot(e);setShowAdd(false);}}><span className="meta"><span className="choice-title">{e.name}</span><span className="choice-sub">{workoutTypeName(data,e.workoutTypeId)}</span></span><span className="chevron">›</span></button>)}</div></div></div>}
  <button className="primary" onClick={editing?saveEdit:finish}>{editing?'Сохранить изменения':'Завершить тренировку'}</button>
  {showMeta && <WorkoutMetaEditor data={data} workout={workout} onClose={()=>setShowMeta(false)} onSave={w=>{onChange(w);setShowMeta(false)}}/>}
 </div>
}

function ExerciseCard({data,workout,we,ex,open,setOpen,onUpdate,onMove,onSkip,onDelete,onTimer,onClose}:{data:AppData;workout:Workout;we:WorkoutExercise;ex:Exercise;open:boolean;setOpen:()=>void;onUpdate:(p:Partial<WorkoutExercise>)=>void;onMove:(d:-1|1)=>void;onSkip:()=>void;onDelete:()=>void;onTimer:(s:number)=>void;onClose:()=>void}){
 const [weight,setWeight]=useState<string>(()=>{const prev=we.sets[we.sets.length-1]?.weight;return prev==null?'':String(prev)});
 const [reps,setReps]=useState<string>('');
 const [comment,setComment]=useState('');
 const [menu,setMenu]=useState(false);
 const [pendingSetDelete,setPendingSetDelete]=useState<string|null>(null);
 const [pendingExerciseDelete,setPendingExerciseDelete]=useState(false);
 const hist=latestTwoExecutions(data,workout.typeId,ex.id);
 useEffect(()=>{const prev=we.sets[we.sets.length-1]?.weight;if(prev!=null)setWeight(String(prev));},[we.sets.length]);
 const saveSet=()=>{
   const w=weight.trim()===''?null:Number(weight.replace(',','.'));
   const r=reps.trim()===''?null:Number(reps.replace(',','.'));
   if(r===null || Number.isNaN(r)){ haptic('error'); return; }
   const s:SetEntry={id:uid(),order:we.sets.length+1,weight:w,reps:r,comment:comment.trim()||undefined};
   onUpdate({sets:[...we.sets,s]}); setReps(''); setComment(''); haptic(); onTimer(180);
 };
 const copyLast=()=>{
   const previous=lastExecution(data,workout.typeId,ex.id);
   const p=previous?.workoutExercise.sets.at(-1);
   if(!p)return;
   setWeight(p.weight==null?'':String(p.weight));
   setReps(p.reps==null?'':String(p.reps));
   setComment(p.comment??'');
   haptic();
 };
 return <div className="card exercise-card">
  <div className="exercise-head"><button style={{background:'transparent',color:'inherit',padding:0,textAlign:'left',cursor:'pointer'}} onClick={setOpen}><div className="exercise-name">{ex.name}</div><div className="muted" style={{fontSize:12,marginTop:3}}>{we.skipped?'Пропущено':`${we.sets.length} подходов`}</div></button>
    <div className="exercise-actions"><button className="icon-btn" title="выше" onClick={()=>onMove(-1)}>↑</button><button className="icon-btn" title="ниже" onClick={()=>onMove(1)}>↓</button><button className="icon-btn" title="действия" onClick={()=>setMenu(v=>!v)}>•••</button>{menu&&<div className="exercise-menu"><button onClick={()=>{setOpen();setMenu(false)}}>Редактировать</button><button onClick={()=>{setPendingExerciseDelete(true);setMenu(false)}}>Удалить</button></div>}</div>
  </div>
  {hist.length>0 && <div className="history-strip"><div className="history-date">Последние тренировки</div>{hist.map(h=><div key={h.workout.id} style={{marginBottom:4}}><strong style={{fontSize:13}}>{formatDate(h.workout.date)}</strong> <span className="muted" style={{fontSize:12}}>·</span> <span style={{fontSize:13}}>{h.workoutExercise.sets.map(s=>`${formatWeight(s.weight)}×${formatReps(s.reps)}`).join(' · ')}</span></div>)}</div>}
  {open && !we.skipped && <>
    <div style={{marginTop:8}}>{we.sets.map(s=><div className="set-line" key={s.id}><span className="set-num">{s.order}</span><span>{formatWeight(s.weight)} кг</span><span>{formatReps(s.reps)} повт.</span><button className="icon-btn" onClick={()=>setPendingSetDelete(s.id)}>×</button></div>)}</div>
    {pendingSetDelete && <div className="modal-backdrop" onClick={()=>setPendingSetDelete(null)}><div className="modal confirm-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>Удалить подход?</h2><button className="icon-btn" onClick={()=>setPendingSetDelete(null)}>×</button></div><p className="muted">Этот подход будет удалён из тренировки.</p><div className="action-row" style={{marginTop:14}}><button className="secondary" onClick={()=>setPendingSetDelete(null)}>Отмена</button><button className="primary danger-button" onClick={()=>{onUpdate({sets:we.sets.filter(x=>x.id!==pendingSetDelete).map((x,i)=>({...x,order:i+1}))});setPendingSetDelete(null)}}>Удалить</button></div></div></div>}
    {pendingExerciseDelete && <div className="modal-backdrop" onClick={()=>setPendingExerciseDelete(false)}><div className="modal confirm-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>Удалить упражнение?</h2><button className="icon-btn" onClick={()=>setPendingExerciseDelete(false)}>×</button></div><p className="muted">Упражнение и все сохранённые подходы исчезнут из этой тренировки.</p><div className="action-row" style={{marginTop:14}}><button className="secondary" onClick={()=>setPendingExerciseDelete(false)}>Отмена</button><button className="primary danger-button" onClick={()=>{onDelete();setPendingExerciseDelete(false)}}>Удалить</button></div></div></div>}
    <div className="set-line" style={{borderTop:we.sets.length?'1px solid rgba(128,128,128,.11)':'0'}}><span className="set-num">{we.sets.length+1}</span><input className="input" inputMode="decimal" placeholder="Вес" value={weight} onChange={e=>setWeight(e.target.value)}/><input className="input" inputMode="numeric" placeholder="Повторы" value={reps} onChange={e=>setReps(e.target.value)}/><button className="icon-btn" onClick={saveSet}>✓</button></div>
    <div className="set-actions"><button className="secondary" onClick={copyLast}>Скопировать</button><button className="secondary" onClick={()=>saveSet()}>+ Подход</button></div>
    <textarea className="input comment-input notes" placeholder="Комментарий к следующему подходу (необязательно)" value={comment} onChange={e=>setComment(e.target.value)}/>
    {we.notes && <div className="history-empty">Импортированная заметка: {we.notes}</div>}
    <button className="primary" style={{marginTop:10,width:'100%'}} onClick={onClose}>Готово</button>
  </>}
 </div>
}

function RestTimer({timer,onClose}:{timer:{until:number};onClose:()=>void}){
 const [until,setUntil]=useState(timer.until);
 const [left,setLeft]=useState(Math.max(0,timer.until-Date.now()));
 const [expired,setExpired]=useState(false);
 useEffect(()=>{const id=setInterval(()=>{const n=Math.max(0,until-Date.now());setLeft(n);if(n===0&&!expired){setExpired(true);haptic('success');}},250);return()=>clearInterval(id)},[until,expired]);
 return <div className={`timer-fab ${expired?'timer-expired':''}`}><div><div className="eyebrow">ОТДЫХ</div><div className="timer-time">{expired?'Время вышло':`${String(Math.floor(left/60000)).padStart(2,'0')}:${String(Math.floor((left%60000)/1000)).padStart(2,'0')}`}</div></div><div className="timer-controls"><button className="timer-btn" onClick={()=>{const n=until+30000;setExpired(false);setUntil(n);setLeft(n-Date.now());}}>+30</button><button className="timer-btn" onClick={()=>{const n=Math.max(Date.now(),until-30000);setExpired(false);setUntil(n);setLeft(n-Date.now());}}>−30</button><button className="timer-btn" onClick={onClose}>Готово</button></div></div>
}

function CalendarScreen({data,onOpen}:{data:AppData;onOpen:(w:Workout)=>void}){
 const [month,setMonth]=useState(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1)});
 const y=month.getFullYear(),m=month.getMonth(); const first=new Date(y,m,1); const start=(first.getDay()+6)%7; const days=new Date(y,m+1,0).getDate();
 const byDate=new Map(data.workouts.filter(w=>w.status==='completed').map(w=>[w.date,w]));
 const cells=[]; for(let i=0;i<start;i++)cells.push(<div key={'p'+i}/>); for(let d=1;d<=days;d++){const date=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const w=byDate.get(date);cells.push(<button key={date} className={`cal-day ${date===todayISO()?'today':''}`} onClick={()=>w&&onOpen(w)}>{d}{w&&<span className="cal-dot"/>}</button>)}
 return <div className="screen"><Top title="Календарь"/><div className="card"><div className="calendar-head"><button className="secondary" onClick={()=>setMonth(new Date(y,m-1,1))}>‹</button><strong>{month.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</strong><button className="secondary" onClick={()=>setMonth(new Date(y,m+1,1))}>›</button></div><div className="month-grid" style={{marginTop:12}}>{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(x=><div className="cal-day-name" key={x}>{x}</div>)}{cells}</div></div></div>
}

function HistoryScreen({data,workout,onEdit,onDuplicate}:{data:AppData;workout:Workout;onEdit:()=>void;onDuplicate:()=>void}){ return <div className="screen"><Top title={workout.name || workoutTypeName(data,workout.typeId)} sub={formatLongDate(workout.date)}/><div className="action-row no-print"><button className="secondary" onClick={onEdit}>Редактировать</button><button className="secondary" onClick={onDuplicate}>Дублировать</button></div>{[...workout.exercises].sort((a,b)=>a.order-b.order).map(we=>{const ex=data.exercises.find(e=>e.id===we.exerciseId);if(!ex)return null;return <div className="card" key={we.id}><div className="exercise-name">{ex.name}</div>{we.skipped?<div className="muted" style={{marginTop:6}}>Пропущено</div>:we.sets.map(s=><div key={s.id} className="summary-row"><span>Подход {s.order}</span><span className="summary-result">{formatWeight(s.weight)} кг × {formatReps(s.reps)}</span></div>)}{we.notes&&<div className="history-empty">{we.notes}</div>}</div>})}</div> }

function SummaryScreen({data}:{data:AppData}){
 const [type,setType]=useState<WorkoutTypeId|'all'>('all');
 const [exercise,setExercise]=useState<string>('all');
 const [from,setFrom]=useState(''); const [to,setTo]=useState('');
 const exercises=type==='all'?data.exercises.filter(e=>e.isActive).sort((a,b)=>a.name.localeCompare(b.name,'ru')):getExercisesForType(data,type);
 const filteredWorkouts=data.workouts.filter(w=>w.status==='completed'&&(type==='all'||w.typeId===type)&&(!from||w.date>=from)&&(!to||w.date<=to));
 const rows=useMemo(()=>{const out:Array<{date:string;exercise:string;result:string}> = [];for(const w of [...filteredWorkouts].sort((a,b)=>b.date.localeCompare(a.date)))for(const we of w.exercises){const ex=data.exercises.find(e=>e.id===we.exerciseId);if(!ex||we.skipped||!we.sets.length||(exercise!=='all'&&ex.id!==exercise))continue;out.push({date:w.date,exercise:ex.name,result:we.sets.map(s=>`${formatWeight(s.weight)}×${formatReps(s.reps)}`).join(' · ')});}return out;},[data,exercise,from,to,type]);
 const exportData={...data,workouts:filteredWorkouts};
 const exportXlsx=()=>{const rows=buildExportRows(exportData);const ws=XLSX.utils.aoa_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Тренировки');XLSX.writeFile(wb,`gym-log-${todayISO()}.xlsx`);};
 const exportCsv=()=>{const rows=buildExportRows(exportData).map(r=>r.map(csvEscape).join(';')).join('\\n');downloadText(`gym-log-${todayISO()}.csv`,'\\uFEFF'+rows,'text/csv;charset=utf-8');};
 const print=()=>window.print();
 return <div className="screen"><Top title="Сводка" sub="Фильтры и экспорт"/><div className="card"><div className="filter-grid"><label className="field-label">Группа<select className="input" value={type} onChange={e=>{setType(e.target.value as WorkoutTypeId|'all');setExercise('all')}}><option value="all">Все группы</option>{data.workoutTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="field-label">Упражнение<select className="input" value={exercise} onChange={e=>setExercise(e.target.value)}><option value="all">Все упражнения</option>{exercises.map(e=><option value={e.id} key={e.id}>{e.name}</option>)}</select></label><label className="field-label">От<input className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="field-label">До<input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div><div className="filter-actions"><button className="secondary" onClick={()=>{setType('all');setExercise('all');setFrom('');setTo('')}}>Сбросить</button></div></div>{rows.length===0?<div className="card muted">Нет данных по выбранному фильтру.</div>:<div className="summary-group">{rows.map((r,i)=><div className="card summary-row" key={i}><div className="summary-main"><div className="summary-name">{r.exercise}</div><div className="muted" style={{fontSize:12,marginTop:3}}>{formatDate(r.date)}</div></div><div className="summary-result">{r.result}</div></div>)}</div>}<div className="tool-row no-print"><button className="tool" onClick={exportXlsx}><strong>Excel</strong><span>Скачать .xlsx</span></button><button className="tool" onClick={print}><strong>PDF</strong><span>Сохранить PDF</span></button><button className="tool" onClick={exportCsv}><strong>CSV</strong><span>Дополнительный экспорт</span></button></div></div>
}
function SettingsScreen({data,onChange}:{data:AppData;onChange:(d:AppData)=>Promise<void>|void}){
 const [addName,setAddName]=useState('');
 const [target,setTarget]=useState<WorkoutTypeId>(data.workoutTypes[0].id);
 const [draggingId,setDraggingId]=useState<string|null>(null);
 const dragId=useRef<string|null>(null);
 const exercises=getExercisesForType(data,target);
 const normalize=(items:Exercise[])=>{const order=new Map(items.map((x,i)=>[x.id,i+1]));return data.exercises.map(x=>order.has(x.id)?{...x,sortOrder:order.get(x.id)!}:x)};
 const add=()=>{const name=addName.trim();if(!name)return;const existing=data.exercises.find(e=>e.workoutTypeId===target&&e.name.trim().toLowerCase()===name.toLowerCase());if(existing){const max=Math.max(0,...data.exercises.filter(e=>e.workoutTypeId===target&&e.isActive&&e.id!==existing.id).map(e=>e.sortOrder));onChange({...data,exercises:data.exercises.map(e=>e.id===existing.id?{...e,isActive:true,sortOrder:max+1}:e)})}else{const max=Math.max(0,...data.exercises.filter(e=>e.workoutTypeId===target).map(e=>e.sortOrder));const ex:Exercise={id:uid(),name,workoutTypeId:target,loadType:'weight',sortOrder:max+1,isActive:true};onChange({...data,exercises:[...data.exercises,ex]})}setAddName('')};
 const remove=(id:string)=>{const active=exercises.filter(e=>e.id!==id);onChange({...data,exercises:normalize(active).map(x=>x.id===id?{...x,isActive:false}:x)})};
 const reorder=(fromId:string,toId:string)=>{if(fromId===toId)return;const arr=[...exercises];const from=arr.findIndex(x=>x.id===fromId),to=arr.findIndex(x=>x.id===toId);if(from<0||to<0)return;const [item]=arr.splice(from,1);arr.splice(to,0,item);onChange({...data,exercises:normalize(arr)})};
 const startDrag=(id:string,e:React.PointerEvent)=>{if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();dragId.current=id;setDraggingId(id);haptic();(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)};
 const moveDrag=(e:React.PointerEvent)=>{if(!dragId.current)return;e.preventDefault();const el=document.elementFromPoint(e.clientX,e.clientY)?.closest('.settings-item') as HTMLElement|null;const overId=el?.dataset.id;if(overId&&overId!==dragId.current)reorder(dragId.current,overId)};
 const endDrag=()=>{dragId.current=null;setDraggingId(null)};
 return <div className="screen"><Top title="Настройки" sub="Шаблоны тренировок"/><div className="card"><div className="segmented">{data.workoutTypes.map(t=><button key={t.id} className={target===t.id?'active':''} onClick={()=>setTarget(t.id)}>{t.name}</button>)}</div><div className="settings-list">{exercises.map(ex=><div className={'settings-item '+(draggingId===ex.id?'is-dragging':'')} data-id={ex.id} key={ex.id} onPointerDown={e=>startDrag(ex.id,e)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><span className="settings-drag-hint" aria-hidden="true">≡</span><span className="settings-name">{ex.name}</span><button className="settings-delete" aria-label={'Удалить '+ex.name+' из шаблона'} onPointerDown={e=>e.stopPropagation()} onClick={()=>remove(ex.id)}>−</button></div>)}{exercises.length===0&&<div className="muted settings-empty">В шаблоне пока нет упражнений</div>}</div><div className="settings-tip">Нажми и удерживай строку, затем перетащи её в нужное место.</div></div><div className="card"><div className="exercise-name">Добавить упражнение</div><div className="form-grid" style={{marginTop:10}}><input className="input" value={addName} onChange={e=>setAddName(e.target.value)} placeholder="Название упражнения"/><button className="primary" onClick={add}>Добавить в шаблон</button></div><div className="muted" style={{fontSize:12,marginTop:8}}>Разовое добавление во время тренировки остаётся доступно отдельно.</div></div></div>
}
function WorkoutMetaEditor({data,workout,onClose,onSave}:{data:AppData;workout:Workout;onClose:()=>void;onSave:(w:Workout)=>void}){
 const [date,setDate]=useState(workout.date); const [name,setName]=useState(workout.name??''); const [type,setType]=useState(workout.typeId);
 return <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>Данные тренировки</h2><button className="icon-btn" onClick={onClose}>×</button></div><div className="form-grid"><label className="field-label">Название<input className="input" value={name} onChange={e=>setName(e.target.value)} placeholder={workoutTypeName(data,type)}/></label><label className="field-label">Тип<select className="input" value={type} onChange={e=>setType(e.target.value as WorkoutTypeId)}>{data.workoutTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="field-label">Дата<input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button className="primary" onClick={()=>onSave({...workout,name:name.trim()||undefined,typeId:type,date})}>Сохранить</button></div></div></div>
}

function NotFound(){return <div className="card">Не найдено.</div>}


createRoot(document.getElementById('root')!).render(<App/>);
