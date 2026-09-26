import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import type { AppData, Exercise, LoadType, Screen, SetEntry, Workout, WorkoutExercise, WorkoutTypeId } from './types';
import { getAppData, isRemoteConfigured, saveRemoteData, notifyTimerExpired, ensureMenuButton, deleteRemoteWorkout } from './api';
import { formatDate, formatLongDate, formatReps, formatWeight, getExercisesForType, latestTwoExecutions, lastExecution, startWorkout, todayISO, uid, workoutTypeName, csvEscape, buildExportRows, ensureWorkoutExercises, downloadText } from './utils';
import { getTelegram, haptic, initTelegram } from './telegram';
import './styles.css';

function App(){
  const [data,setData]=useState<AppData|null>(null);
  const [screen,setScreen]=useState<Screen>({kind:'home'});
  const [timer,setTimer]=useState<{until:number}|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [showWelcomeTour,setShowWelcomeTour]=useState(false);
  const workoutBack=useRef<()=>void>(()=>{});
  const syncQueue=useRef<Promise<void>>(Promise.resolve());

  useEffect(()=>{ initTelegram(); getAppData().then(next=>{const settings=next.settings ?? {restTimerSeconds:120,restTimerEnabled:true,theme:'dark',accentColor:'red'}; const demoResetKey='gym-tracker-demo-onboarding-reset-v2'; const shouldReplayOnboarding=localStorage.getItem(demoResetKey)!=='done'; setData({...next,settings,onboardingComplete:shouldReplayOnboarding?false:next.onboardingComplete}); ensureMenuButton().catch(()=>undefined)}).catch(e=>setError(String(e))).finally(()=>setLoading(false)); },[]);
  useEffect(()=>{
    const tg=getTelegram(); if(!tg) return;
    const handler=()=>workoutBack.current();
    tg.BackButton.onClick(handler); return ()=>tg.BackButton.offClick(handler);
  },[]);
  useEffect(()=>{if(!data)return;const s=data.settings ?? {restTimerSeconds:120,restTimerEnabled:true,theme:'dark',accentColor:'red'};document.documentElement.dataset.appTheme=s.theme;document.documentElement.dataset.appAccent=s.accentColor;document.documentElement.style.setProperty('--tg-bg-color',s.theme==='dark'?'#000':'#f2f2f7');document.documentElement.style.setProperty('--tg-secondary-bg-color',s.theme==='dark'?'#2c2c2e':'#fff');document.documentElement.style.setProperty('--tg-text-color',s.theme==='dark'?'#f5f5f7':'#111');document.documentElement.style.setProperty('--tg-hint-color',s.theme==='dark'?'#a1a1a6':'#8e8e93');const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute('content',s.theme==='dark'?'#000000':'#f2f2f7');},[data?.settings?.theme,data?.settings?.accentColor]);
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
      .then(()=>{setError(null)})
      .catch(e=>{ setError(`Не удалось синхронизировать: ${String(e)}`); });
    return syncQueue.current;
  };
  if(loading) return <div className="splash-screen"><div className="splash-title">gym tracker</div><div className="splash-subtitle">мини-приложение</div><a className="splash-author" href="https://t.me/marieblokh" target="_blank" rel="noreferrer">vibe coded by @marieblokh</a><div className="splash-loader"><span/><span/><span/></div></div>;
  if(!data) return <div className="app"><div className="card"><h2>Не удалось открыть журнал</h2><p className="muted">{error}</p></div></div>;

  let body:React.ReactNode;
  if(screen.kind==='home' && !data.onboardingComplete) {
    body=<Onboarding data={data} onComplete={(next)=>{localStorage.setItem('gym-tracker-demo-onboarding-reset-v2','done');commit({...next,onboardingComplete:true}).then(()=>{setScreen({kind:'home'});setShowWelcomeTour(true);});}}/>;
  } else if(screen.kind==='home') body=<Home data={data}
    onStart={(typeId)=>{const w=startWorkout(data,typeId);setScreen({kind:'workout',typeId,workoutId:w.id});commit({...data,workouts:[...data.workouts,w]});}}
    onContinue={(draft)=>{const ensured=ensureWorkoutExercises(draft,data);if(ensured!==draft)commit({...data,workouts:data.workouts.map(w=>w.id===draft.id?ensured:w)});setScreen({kind:'workout',typeId:draft.typeId,workoutId:draft.id});}}
    onNav={setScreen}/>;
  if(screen.kind==='workout') {
    const w0=data.workouts.find(w=>w.id===screen.workoutId);
    body=w0?<WorkoutScreen data={data} workout={w0} editing={screen.mode==='edit'}
      onChange={w=>commit({...data,workouts:data.workouts.map(x=>x.id===w.id?{...w,updatedAt:new Date().toISOString()}:x)})}
      onFinish={w=>commit({...data,workouts:data.workouts.map(x=>x.id===w.id?{...x,status:'completed',completedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}:x)})}
      onTimer={(seconds)=>setTimer({until:Date.now()+seconds*1000})}
      onHome={()=>setScreen({kind:'home'})}
      onDeleteDraft={async()=>{
        const next={...data,workouts:data.workouts.filter(x=>x.id!==w0.id)};
        await deleteRemoteWorkout(w0.id);
        setTimer(null);
        await commit(next);
        setScreen({kind:'home'});
      }}
    />:<NotFound/>;
  }
  if(screen.kind==='calendar') body=<CalendarScreen data={data} onOpen={w=>setScreen({kind:'history',workoutId:w.id})}/>;
  if(screen.kind==='history') { const w=data.workouts.find(x=>x.id===screen.workoutId); body=w?<HistoryScreen data={data} workout={w}
  onEdit={()=>setScreen({kind:'workout',typeId:w.typeId,workoutId:w.id,mode:'edit'})}
  onDuplicate={()=>{const copy:Workout={...w,id:uid(),date:todayISO(),status:'draft',createdAt:new Date().toISOString(),completedAt:undefined,name:w.name,exercises:w.exercises.map(we=>({...we,id:uid(),sets:we.sets.map(s=>({...s,id:uid()}))}))};commit({...data,workouts:[...data.workouts,copy]}).then(()=>setScreen({kind:'workout',typeId:copy.typeId,workoutId:copy.id}));}}
  onRepeat={()=>{const copy:Workout={...w,id:uid(),date:todayISO(),status:'draft',createdAt:new Date().toISOString(),completedAt:undefined,name:w.name,exercises:w.exercises.map(we=>({...we,id:uid(),sets:[],notes:undefined}))};commit({...data,workouts:[...data.workouts,copy]}).then(()=>setScreen({kind:'workout',typeId:copy.typeId,workoutId:copy.id}));}}
  onDelete={async()=>{const next={...data,workouts:data.workouts.filter(x=>x.id!==w.id)};await deleteRemoteWorkout(w.id);await commit(next);setScreen({kind:'home'});}}/>:<NotFound/>; }
  if(screen.kind==='summary') body=<SummaryScreen data={data}/>;
  if(screen.kind==='settings') body=<SettingsScreen data={data} onChange={commit}/>;
  const appSettings=data.settings ?? {restTimerSeconds:120,restTimerEnabled:true,theme:'dark',accentColor:'red'};
  return <div className={`app theme-${appSettings.theme} accent-${appSettings.accentColor}`}>{error && <div className="notice no-print">{error}</div>}{body}{timer && <RestTimer timer={timer} onClose={()=>setTimer(null)}/>} {showWelcomeTour && <WelcomeTour onClose={()=>setShowWelcomeTour(false)}/>}</div>;
}


const ONBOARDING_TEMPLATES = [
 {id:'fullbody',name:'Fullbody',slug:'fullbody',exercises:['Жим ногами','Тяга верхнего блока','Жим лёжа','Жим гантелей сидя','Румынская тяга','Подъём на бицепс','Трицепс на блоке','Скручивания']},
 {id:'legs',name:'Ноги',slug:'legs',exercises:['Жим ногами','Разгибание ног','Сгибание ног','Икры','Болгарские приседания']},
 {id:'glutes',name:'Ягодицы',slug:'glutes',exercises:['Ягодичный мост','Отведение ноги назад','Болгарские приседания','Румынская тяга','Гиперэкстензия']},
 {id:'back',name:'Спина',slug:'back',exercises:['Тяга верхнего блока','Тяга нижнего блока','Тяга сидя','Подтягивания','Тяга гантели в наклоне']},
 {id:'chest',name:'Грудь',slug:'chest',exercises:['Жим лёжа','Жим гантелей','Разведение гантелей','Сведение рук','Отжимания']},
 {id:'shoulders',name:'Плечи',slug:'shoulders',exercises:['Жим гантелей сидя','Разведение в стороны','Задняя дельта','Тяга к подбородку']},
 {id:'arms',name:'Руки',slug:'arms',exercises:['Подъём на бицепс','Молотки','Разгибание на трицепс','Трицепс на блоке']}
] as const;

function formatDraftTime(value:string){const d=new Date(value),n=new Date();return d.toDateString()===n.toDateString()?d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('ru-RU',{day:'numeric',month:'short'})+' · '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});}
function Onboarding({data,onComplete}:{data:AppData;onComplete:(next:AppData)=>void}){
 const [step,setStep]=useState(1);
 const [selected,setSelected]=useState<string[]>(['fullbody']);
 const [customTemplates,setCustomTemplates]=useState<Array<{id:string;name:string;slug:string;exercises:string[]}>>([]);
 const [templateName,setTemplateName]=useState('');
 const [current,setCurrent]=useState(0);
 const [chosen,setChosen]=useState<Record<string,string[]>>({});
 const [custom,setCustom]=useState('');
 const [theme,setTheme]=useState<'light'|'dark'>(data.settings?.theme ?? 'dark');
 const [accentColor,setAccentColor]=useState(data.settings?.accentColor ?? 'red');
 const [timerEnabled,setTimerEnabled]=useState(data.settings?.restTimerEnabled ?? true);
 const [timerSeconds,setTimerSeconds]=useState(data.settings?.restTimerSeconds ?? 120);

 useEffect(()=>{
   const root=document.documentElement;
   const app=document.querySelector('.app');
   if(app){
     app.classList.remove('theme-light','theme-dark','accent-red','accent-purple','accent-blue','accent-teal','accent-green','accent-orange','accent-yellow');
     app.classList.add('theme-'+theme,'accent-'+accentColor);
   }
   root.dataset.appTheme=theme;
   root.dataset.appAccent=accentColor;
   root.style.setProperty('--tg-bg-color',theme==='dark'?'#000':'#f2f2f7');
   root.style.setProperty('--tg-secondary-bg-color',theme==='dark'?'#2c2c2e':'#fff');
   root.style.setProperty('--tg-text-color',theme==='dark'?'#f5f5f7':'#111');
   root.style.setProperty('--tg-hint-color',theme==='dark'?'#a1a1a6':'#8e8e93');
   const meta=document.querySelector('meta[name="theme-color"]');
   if(meta)meta.setAttribute('content',theme==='dark'?'#000000':'#f2f2f7');
 },[theme,accentColor]);

 const templates=[...ONBOARDING_TEMPLATES,...customTemplates].filter(t=>selected.includes(t.id));
 const currentTemplate=templates[current];
 const toggleTemplate=(id:string)=>setSelected(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);
 const addTemplate=()=>{
   const name=templateName.trim();
   if(!name)return;
   const exists=[...ONBOARDING_TEMPLATES,...customTemplates].some(t=>t.name.trim().toLowerCase()===name.toLowerCase());
   if(exists)return;
   const id='custom-'+uid();
   setCustomTemplates(v=>[...v,{id,name,slug:name.toLowerCase().replace(/[^a-zа-я0-9]+/gi,'-').replace(/^-|-$/g,''),exercises:[]}]);
   setSelected(v=>[...v,id]);
   setTemplateName('');
 };
 const removeCustomTemplate=(id:string)=>{
   setCustomTemplates(v=>v.filter(t=>t.id!==id));
   setSelected(v=>v.filter(x=>x!==id));
 };
 const toggleExercise=(name:string)=>currentTemplate&&setChosen(v=>{const a=v[currentTemplate.id]??[];return {...v,[currentTemplate.id]:a.includes(name)?a.filter(x=>x!==name):[...a,name]};});
 const addCustom=()=>{if(!currentTemplate||!custom.trim())return;const name=custom.trim();setChosen(v=>({...v,[currentTemplate.id]:[...(v[currentTemplate.id]??[]),name]}));setCustom('');};
 const finish=()=>{
   const workoutTypes=templates.map(t=>({id:t.id,name:t.name,slug:t.slug}));
   const exercises:Exercise[]=[];
   templates.forEach(t=>(chosen[t.id]??[]).forEach((name,i)=>exercises.push({id:uid(),workoutTypeId:t.id,name,loadType:'weight',sortOrder:i+1,isActive:true})));
   onComplete({...data,workoutTypes,exercises,workouts:[],onboardingComplete:true,settings:{restTimerSeconds:timerSeconds,restTimerEnabled:timerEnabled,theme,accentColor}});
 };
 if(step===1)return <div className="onboarding screen">
   <div className="onboarding-hero"><div className="onboarding-kicker">GYM TRACKER</div><h1>Настроим тренировки</h1><p>Выберите готовые шаблоны тренировочных дней или создайте свои. Один шаблон — один отдельный тренировочный день.</p></div>
   <div className="onboarding-options">{ONBOARDING_TEMPLATES.map(t=><button key={t.id} className={'onboarding-group '+(selected.includes(t.id)?'selected':'')} onClick={()=>toggleTemplate(t.id)}><span className="onboarding-template-name">{t.name}</span><i>✓</i></button>)}</div>
   {customTemplates.length>0&&<div className="onboarding-custom-list">{customTemplates.map(t=><div key={t.id} className={'onboarding-custom-row '+(selected.includes(t.id)?'selected':'')}><button className="onboarding-custom-select" onClick={()=>toggleTemplate(t.id)}><span className="onboarding-template-name">{t.name}</span><i>✓</i></button><button className="onboarding-custom-delete" aria-label={'Удалить шаблон '+t.name} onClick={()=>removeCustomTemplate(t.id)}>×</button></div>)}</div>}
   <div className="custom-template-box"><div className="settings-section-title">СВОЙ ШАБЛОН</div><div className="form-grid"><input className="input" value={templateName} onChange={e=>setTemplateName(e.target.value)} placeholder="Например, Ноги + ягодицы"/><button className="secondary" disabled={!templateName.trim()} onClick={addTemplate}>Добавить шаблон</button></div></div>
   <div className="onboarding-hint">Например, «Ноги + ягодицы» можно сделать одним шаблоном вместо двух. Шаблоны и их названия можно изменить позже в настройках.</div>
   <button className="primary onboarding-next" disabled={!selected.length} onClick={()=>{setCurrent(0);setChosen(Object.fromEntries(templates.map(t=>[t.id,t.exercises.slice(0,2)])));setStep(2)}}>Далее</button>
 </div>;
 if(step===2)return <div className="onboarding screen">
   <div className="onboarding-progress"><span>ШАГ 2 · ТАЙМЕР</span><b>Настройка</b></div>
   <div className="onboarding-hero"><div className="onboarding-kicker">ТАЙМЕР ОТДЫХА</div><h1>Нужен таймер между подходами?</h1><p>После сохранения подхода таймер будет запускаться автоматически. Настройку можно изменить в любой момент.</p></div>
   <div className="onboarding-settings-card">
     <div className="onboarding-setting-row"><div><strong>Таймер отдыха</strong><span>{timerEnabled?'Запускать после каждого подхода':'Не использовать таймер'}</span></div><button className={'ios-switch '+(timerEnabled?'on':'')} aria-label="Таймер отдыха" onClick={()=>setTimerEnabled(v=>!v)}><span/></button></div>
     {timerEnabled&&<div className="onboarding-setting-block"><strong>Длительность</strong><div className="timer-choice-grid">{Array.from({length:10},(_,i)=>(i+1)*30).map(s=><button key={s} className={'timer-choice '+(timerSeconds===s?'active':'')} onClick={()=>setTimerSeconds(s)}>{Math.floor(s/60)}:{String(s%60).padStart(2,'0')}</button>)}</div><div className="onboarding-hint" style={{padding:'9px 0 0'}}>Шаг 30 секунд</div></div>}
   </div>
   <div className="onboarding-hint">Позже таймер можно включить или отключить и изменить длительность в настройках.</div>
   <div className="onboarding-actions"><button className="secondary" onClick={()=>setStep(1)}>Назад</button><button className="primary" onClick={()=>{setCurrent(0);setStep(3)}}>Далее</button></div>
 </div>;
 if(step===3&&!currentTemplate)return null;
 if(step===3)return <div className="onboarding screen">
   <div className="onboarding-progress"><span>ШАГ 3 · УПРАЖНЕНИЯ</span><b>{current+1} / {templates.length}</b></div>
   <div className="onboarding-hero"><div className="onboarding-kicker">{currentTemplate.name}</div><h1>Соберите шаблон</h1><p>Выберите упражнения, которые хотите видеть в этом тренировочном дне.</p></div>
   {currentTemplate.exercises.length>0&&<div className="onboarding-options">{currentTemplate.exercises.map(name=><button key={name} className={'onboarding-exercise '+((chosen[currentTemplate.id]??[]).includes(name)?'selected':'')} onClick={()=>toggleExercise(name)}><span>{name}</span><i>✓</i></button>)}</div>}
   <div className="custom-exercise-box"><div className="settings-section-title">СВОЁ УПРАЖНЕНИЕ</div><div className="form-grid"><input className="input" value={custom} onChange={e=>setCustom(e.target.value)} placeholder="Название упражнения"/><button className="secondary" onClick={addCustom}>Добавить в шаблон</button></div></div>
   {(chosen[currentTemplate.id]??[]).length>0&&<div className="onboarding-selected-exercises"><div className="settings-section-title">В ШАБЛОНЕ</div>{(chosen[currentTemplate.id]??[]).map((name,i)=><div className="onboarding-selected-row" key={name+i}><span>{name}</span><button onClick={()=>setChosen(v=>({...v,[currentTemplate.id]:(v[currentTemplate.id]??[]).filter((_,idx)=>idx!==i)}))}>×</button></div>)}</div>}
   <div className="onboarding-hint">Эти упражнения можно изменить позже в настройках.</div>
   <div className="onboarding-actions"><button className="secondary" disabled={current===0} onClick={()=>setCurrent(v=>v-1)}>Назад</button>{current<templates.length-1?<button className="primary" onClick={()=>setCurrent(v=>v+1)}>Следующая тренировка</button>:<button className="primary" onClick={()=>setStep(4)}>Далее</button>}</div>
 </div>;
 const accentOptions=[['red','Красный','#ff375f'],['purple','Фиолетовый','#af52de'],['blue','Синий','#0a84ff'],['teal','Бирюзовый','#14b8a6'],['green','Зелёный','#30d158'],['orange','Оранжевый','#ff9f0a'],['yellow','Жёлтый','#ffd60a']] as const;
 return <div className="onboarding screen">
   <div className="onboarding-progress"><span>ШАГ 4 · ОФОРМЛЕНИЕ</span><b>Готово</b></div>
   <div className="onboarding-hero"><div className="onboarding-kicker">ОФОРМЛЕНИЕ</div><h1>Настройте приложение</h1><p>Выберите тему и акцентный цвет.</p></div>
   <div className="onboarding-settings-card">
     <div className="onboarding-setting-row"><div><strong>Тема</strong><span>Светлая или тёмная</span></div><div className="segmented compact"><button className={theme==='light'?'active':''} onClick={()=>setTheme('light')}>Белая</button><button className={theme==='dark'?'active':''} onClick={()=>setTheme('dark')}>Чёрная</button></div></div>
     <div className="onboarding-setting-block"><strong>Акцентный цвет</strong><div className="accent-options">{accentOptions.map(([id,name,color])=><button key={id} title={name} aria-label={name} className={'accent-swatch '+(accentColor===id?'selected':'')} style={{'--swatch':color} as React.CSSProperties} onClick={()=>setAccentColor(id)}><span/></button>)}</div></div>
   </div>
   <div className="onboarding-hint">Тему и акцентный цвет можно изменить позже в настройках.</div>
   <div className="onboarding-actions"><button className="secondary" onClick={()=>setStep(3)}>Назад</button><button className="primary" onClick={finish}>Начать</button></div>
 </div>;
}
function WelcomeTour({onClose}:{onClose:()=>void}){
 const [tourStep,setTourStep]=useState(0);
 const slides=[
  {kicker:'НАЧНЁМ',title:'Записывай тренировки',text:'Подходы, повторения и вес — всё остаётся в истории.',icon:'legs'},
  {kicker:'ИСТОРИЯ',title:'Возвращайся к прошлым дням',text:'Календарь помогает быстро найти любую тренировку и открыть её детали.',icon:'calendar'},
  {kicker:'ПРОГРЕСС',title:'Смотри, как меняются результаты',text:'История, лучшие результаты и экспорт данных — в одном месте.',icon:'chart'},
  {kicker:'НАСТРОЙКИ',title:'Подстрой приложение под себя',text:'Шаблоны, упражнения, нагрузка, таймер, тема и акцентный цвет.',icon:'settings'},
  {kicker:'ВСЁ ГОТОВО',title:'Можно тренироваться',text:'Остальное приложение покажет по ходу. Начни с первой тренировки.',icon:'arms'}
 ] as const;
 const slide=slides[tourStep];
 return <div className="welcome-tour-backdrop">
  <div className="welcome-tour" role="dialog" aria-modal="true">
   <div className="welcome-tour-progress">{slides.map((_,i)=><span key={i} className={i===tourStep?'active':''}/>)}</div>
   <div className="welcome-tour-icon"><AppIcon kind={slide.icon}/></div>
   <div className="onboarding-kicker">{slide.kicker}</div>
   <h1>{slide.title}</h1>
   <p className="welcome-tour-lead">{slide.text}</p>
   <div className="welcome-tour-footer">
    {tourStep>0?<button className="secondary welcome-tour-back" onClick={()=>setTourStep(v=>v-1)}>Назад</button>:<span/>}
    {tourStep<slides.length-1?<button className="primary" onClick={()=>setTourStep(v=>v+1)}>Далее</button>:<button className="primary" onClick={onClose}>Начать</button>}
   </div>
  </div>
 </div>
}
function Top({title,sub,action}:{title:string;sub?:string;action?:React.ReactNode}){ return <div className="topbar"><div><div className="eyebrow">GYM LOG</div><h1>{title}</h1>{sub&&<div className="muted" style={{marginTop:5}}>{sub}</div>}</div>{action}</div> }

function AppIcon({kind}:{kind:'legs'|'arms'|'back'|'calendar'|'chart'|'settings'}){
 const paths={legs:'M12 3v7m0 0 4 4m-4-4-4 4m4-4v8m0 0-3 3m3-3 3 3',arms:'M8 19v-6l-2-2 2-5 3 3 3-3 2 5-2 2v6',back:'M8 4v6m8-6v6M8 10l-3 3m11-3 3 3M12 4v16',calendar:'M6 3v3m12-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',chart:'M5 19V9m7 10V5m7 14v-7',settings:'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 9v2m0 5v-2m9-7h-2m-12 0H5m13.36-6.36-1.42 1.42M7.06 16.94l-1.42 1.42m12.72 0-1.42-1.42M7.06 7.06 5.64 5.64'};
 return <span className={'app-icon app-icon-'+kind} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]}/></svg></span>
}

function toISODate(d:Date){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function Home({data,onStart,onContinue,onNav}:{data:AppData;onStart:(t:WorkoutTypeId)=>void;onContinue:(w:Workout)=>void;onNav:(s:Screen)=>void}){
 const today=todayISO(); const [showStart,setShowStart]=useState(false);
 const [month,setMonth]=useState(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1)});
 const [selectedDate,setSelectedDate]=useState<string|null>(null);
 const completed=data.workouts.filter(w=>w.status==='completed');
 const now=new Date(`${today}T12:00:00`); const monday=new Date(now); monday.setDate(monday.getDate()-((monday.getDay()+6)%7)); monday.setHours(0,0,0,0);
 const sunday=new Date(monday); sunday.setDate(monday.getDate()+7);
 const weekCompleted=completed.filter(w=>{const d=new Date(`${w.date}T12:00:00`);return d>=monday&&d<sunday});
 const weekCount=Array.from(new Map(weekCompleted.map(w=>[w.id,w])).values()).length;
 const last=[...completed].sort((a,b)=>(b.completedAt??b.date).localeCompare(a.completedAt??a.date))[0];
 const previousMonday=new Date(monday); previousMonday.setDate(previousMonday.getDate()-7);
 const previousWeekCompleted=completed.filter(w=>{const d=new Date(`${w.date}T12:00:00`);return d>=previousMonday&&d<monday});
 const previousWeekCount=Array.from(new Map(previousWeekCompleted.map(w=>[w.id,w])).values()).length;
 const weekDelta=weekCount-previousWeekCount;
 const currentMonthStart=new Date(now.getFullYear(),now.getMonth(),1);
 const previousMonthStart=new Date(now.getFullYear(),now.getMonth()-1,1);
 const nextMonthStart=new Date(now.getFullYear(),now.getMonth()+1,1);
 const currentMonthCount=completed.filter(w=>w.date>=toISODate(currentMonthStart)&&w.date<toISODate(nextMonthStart)).length;
 const previousMonthCount=completed.filter(w=>w.date>=toISODate(previousMonthStart)&&w.date<toISODate(currentMonthStart)).length;
 const monthDelta=currentMonthCount-previousMonthCount;
 const drafts=data.workouts.filter(w=>w.status==='draft').sort((a,b)=>(b.updatedAt??b.createdAt).localeCompare(a.updatedAt??a.createdAt)); const draft=drafts[0];
 const y=month.getFullYear(), m=month.getMonth();
 const first=new Date(y,m,1), start=(first.getDay()+6)%7, days=new Date(y,m+1,0).getDate();
 const byDate=new Map<string,Workout[]>();
 completed.forEach(w=>{const list=byDate.get(w.date)??[];list.push(w);byDate.set(w.date,list)});
 const monthWorkouts=completed.filter(w=>w.date.startsWith(`${y}-${String(m+1).padStart(2,'0')}-`));
 const cells:React.ReactNode[]=[];
 for(let i=0;i<start;i++)cells.push(<span key={'empty'+i}/>);
 for(let d=1;d<=days;d++){
   const date=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
   const dayWorkouts=byDate.get(date)??[];
   cells.push(<button type="button" key={date} className={`activity-day ${dayWorkouts.length?'done':''} ${date===today?'current':''}`} onClick={()=>dayWorkouts.length&&setSelectedDate(date)}>{d}</button>);
 }
 const iconForType=(typeId:WorkoutTypeId):'legs'|'arms'|'back' => typeId==='legs'?'legs':typeId==='arms'||typeId==='chest'?'arms':'back'; const startWorkout=(typeId:WorkoutTypeId)=>{haptic();setShowStart(false);onStart(typeId)};
 const selectedWorkouts=selectedDate?([...byDate.get(selectedDate)??[]].sort((a,b)=>(a.completedAt??'').localeCompare(b.completedAt??''))):[];
 return <div className="screen home-screen">
  <div className="home-hero"><div className="home-eyebrow">ТРЕНИРОВКИ</div><h1>Сегодня</h1><div className="home-date">{new Date(`${today}T12:00:00`).toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}</div><button className="home-start primary" onClick={()=>{haptic();draft?onContinue(draft):setShowStart(true)}}>{draft?'Продолжить тренировку':'Начать тренировку'}</button>
  {draft&&<div className="draft-preview" onClick={()=>onContinue(draft)}><div><strong>{workoutTypeName(data,draft.typeId)}</strong><span>{draft.name||'Черновик тренировки'}</span></div><div className="draft-time">изменено {formatDraftTime(draft.updatedAt??draft.createdAt)}<b>›</b></div></div>}</div>
  <section className="home-section"><h2>Твоя активность</h2><div className="week-card activity-stats-grid">
   <div className="activity-stat-tile"><strong>{weekCount}</strong><span>за неделю</span><div className={"activity-stat-delta "+(weekDelta>0?"up":weekDelta<0?"down":"same")}><b>{weekDelta>0?"↗":weekDelta<0?"↘":"→"}</b><span>{Math.abs(weekDelta)}</span></div></div>
   <div className="activity-stat-tile"><strong>{currentMonthCount}</strong><span>за месяц</span><div className={"activity-stat-delta "+(monthDelta>0?"up":monthDelta<0?"down":"same")}><b>{monthDelta>0?"↗":monthDelta<0?"↘":"→"}</b><span>{Math.abs(monthDelta)}</span></div></div>
  </div></section>
  {last&&<section className="home-section"><h2>Последняя тренировка</h2><button className="last-workout-card" onClick={()=>onNav({kind:'history',workoutId:last.id})}><span className="last-workout-icon">↗</span><span className="last-workout-info"><strong>{last.name||workoutTypeName(data,last.typeId)}</strong><span>{formatDate(last.date)} · {last.exercises.filter(x=>x.sets.length>0).length} упражнений</span></span><span className="last-workout-chevron">›</span></button></section>}
  <section className="home-section"><h2>Активность</h2><div className="activity-card">
   <div className="activity-head"><button type="button" className="activity-nav" onClick={()=>setMonth(new Date(y,m-1,1))}>‹</button><span>{month.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</span><button type="button" className="activity-nav" onClick={()=>setMonth(new Date(y,m+1,1))}>›</button></div>
   <div className="activity-count">{monthWorkouts.length} {monthWorkouts.length===1?'тренировка':monthWorkouts.length>=2&&monthWorkouts.length<=4?'тренировки':'тренировок'}</div>
   <div className="activity-weekdays">{['П','В','С','Ч','П','С','В'].map((x,i)=><span key={i}>{x}</span>)}</div>
   <div className="activity-grid">{cells}</div>
  </div></section>
  <div className="home-tools"><button onClick={()=>onNav({kind:'summary'})}><span>Прогресс</span><small>Твои результаты</small><b>›</b></button><button onClick={()=>onNav({kind:'settings'})}><span>Настройки</span><small>Приложение</small><b>›</b></button></div>
  {isRemoteConfigured&&<div className="muted sync-status">Синхронизация включена</div>}
  {selectedDate&&<div className="modal-backdrop" onClick={()=>setSelectedDate(null)}><div className="modal start-modal date-workout-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>{formatLongDate(selectedDate)}</h2><button className="icon-btn" onClick={()=>setSelectedDate(null)}>×</button></div>{selectedWorkouts.map(w=><button key={w.id} className="start-option" onClick={()=>{setSelectedDate(null);onNav({kind:'history',workoutId:w.id})}}><span><strong>{w.name||workoutTypeName(data,w.typeId)}</strong><small>{w.exercises.filter(x=>x.sets.length>0).length} упражнений</small></span><b>›</b></button>)}</div></div>}
  {showStart&&<div className="modal-backdrop" onClick={()=>setShowStart(false)}><div className="modal start-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>Новая тренировка</h2><button className="icon-btn" onClick={()=>setShowStart(false)}>×</button></div><div className="start-options">{data.workoutTypes.map(t=><button className="start-option" key={t.id} onClick={()=>startWorkout(t.id)}><span className={`start-option-icon start-${iconForType(t.id)}`}><AppIcon kind={iconForType(t.id)}/></span><span><strong>{t.name}</strong><small>{data.workoutTypes.length>1?'Тренировка':'Новая тренировка'}</small></span><b>›</b></button>)}</div></div></div>}
 </div>
}
function WorkoutScreen({data,workout,editing,onChange,onFinish,onTimer,onHome,onDeleteDraft}:{data:AppData;workout:Workout;editing?:boolean;onChange:(w:Workout)=>void;onFinish:(w:Workout)=>void;onTimer:(s:number)=>void;onHome:()=>void;onDeleteDraft:()=>Promise<void>}){
 const [currentId,setCurrentId]=useState<string|null>(()=>workout.exercises.find(x=>!x.skipped&&x.sets.length===0)?.id ?? workout.exercises.find(x=>!x.skipped)?.id ?? null);
 const [showAdd,setShowAdd]=useState(false);
 const [customExerciseName,setCustomExerciseName]=useState('');
 const [showMeta,setShowMeta]=useState(false);
 const [showDraftMenu,setShowDraftMenu]=useState(false);
 const [showDraftDeleteConfirm,setShowDraftDeleteConfirm]=useState(false);
 const exercises=[...workout.exercises].sort((a,b)=>a.order-b.order);
 const updateWe=(id:string,patch:Partial<WorkoutExercise>)=>onChange({...workout,exercises:workout.exercises.map(x=>x.id===id?{...x,...patch}:x)});
 const addCustomExercise=()=>{
   const name=customExerciseName.trim(); if(!name)return;
   const max=Math.max(0,...workout.exercises.map(x=>x.order));
   const we:WorkoutExercise={id:uid(),exerciseId:`custom-${uid()}`,customName:name,order:max+1,skipped:false,loadType:'weight',sets:[]};
   onChange({...workout,exercises:[...workout.exercises,we]}); setCustomExerciseName(''); setShowAdd(false); setCurrentId(we.id);
 };
 const addOneShot=(exercise:Exercise)=>{
   const max=Math.max(0,...workout.exercises.map(x=>x.order));
   const we:WorkoutExercise={id:uid(),exerciseId:exercise.id,order:max+1,skipped:false,loadType:exercise.loadType==='bodyweight'?'bodyweight':'weight',sets:[]};
   onChange({...workout,exercises:[...workout.exercises,we]}); setCurrentId(we.id);
 };
 const move=(id:string,dir:-1|1)=>{
   const sorted=[...workout.exercises].sort((a,b)=>a.order-b.order); const i=sorted.findIndex(x=>x.id===id); const j=i+dir; if(i<0||j<0||j>=sorted.length)return;
   const tmp=sorted[i];sorted[i]=sorted[j];sorted[j]=tmp; onChange({...workout,exercises:sorted.map((x,idx)=>({...x,order:idx+1}))});
 };
 const skip=(id:string)=>{updateWe(id,{skipped:true}); if(currentId===id)setCurrentId(null);};
 const removeExercise=(id:string)=>{onChange({...workout,exercises:workout.exercises.filter(x=>x.id!==id)}); if(currentId===id)setCurrentId(null);};
 const [showReview,setShowReview]=useState(false);
 const finish=()=>{haptic('success');onFinish(workout);setShowReview(true);};
 const reviewStats=useMemo(()=>{
   const sets=workout.exercises.flatMap(we=>we.sets);
   const volume=sets.reduce((sum,s)=>sum+(s.weight??0)*(s.reps??0),0);
   const totalReps=sets.reduce((sum,s)=>sum+(s.reps??0),0);
   return {sets:sets.length, exercises:workout.exercises.filter(x=>!x.skipped&&x.sets.length).length, volume, totalReps};
 },[workout]);

 const saveEdit=()=>{haptic('success');onChange({...workout,status:'completed',completedAt:workout.completedAt??new Date().toISOString()});onHome();};
 const typeName=workoutTypeName(data,workout.typeId);
 return <div className="screen">
  <Top title={workout.name || typeName} sub={`${formatLongDate(workout.date)} · ${workout.status==='draft'?'в процессе':'завершено'}`} action={
    <div className="top-action-wrap">
      <button className="top-action" aria-label="Действия с тренировкой" onClick={()=>workout.status==='draft'?setShowDraftMenu(v=>!v):setShowMeta(true)}>•••</button>
      {workout.status==='draft'&&showDraftMenu&&<div className="workout-top-menu">
        <button onClick={()=>{setShowDraftMenu(false);setShowMeta(true)}}>Редактировать данные</button>
        <button className="danger" onClick={()=>{setShowDraftMenu(false);setShowDraftDeleteConfirm(true)}}>Удалить черновик</button>
      </div>}
    </div>
  }/>
  <div className="exercise-list">
   {exercises.map((we,idx)=>{
    const ex=data.exercises.find(e=>e.id===we.exerciseId) ?? (we.customName?{id:we.exerciseId,workoutTypeId:workout.typeId,name:we.customName,loadType:'weight' as LoadType,sortOrder:0,isActive:true}:null); if(!ex)return null;
    const open=currentId===we.id;
    return <ExerciseCard key={we.id} data={data} workout={workout} we={we} ex={ex} open={open} setOpen={()=>setCurrentId(we.id)} onUpdate={p=>updateWe(we.id,p)} onMove={d=>move(we.id,d)} onSkip={()=>skip(we.id)} onDelete={()=>removeExercise(we.id)} onTimer={onTimer} onClose={()=>setCurrentId(null)}/>;
   })}
  </div>
  <button className="secondary" onClick={()=>setShowAdd(true)}>+ Добавить упражнение</button>
  {showAdd && <div className="modal-backdrop" onClick={()=>setShowAdd(false)}><div className="modal add-exercise-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>Добавить упражнение</h2><button className="icon-btn" onClick={()=>setShowAdd(false)}>×</button></div><div className="custom-exercise-form"><label>Своё упражнение</label><div className="custom-exercise-row"><input className="input" autoFocus placeholder="Например, махи в кроссовере" value={customExerciseName} onChange={e=>setCustomExerciseName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')addCustomExercise()}}/><button className="primary" disabled={!customExerciseName.trim()} onClick={addCustomExercise}>Добавить</button></div></div><div className="add-exercise-divider"><span>или выбери из шаблона</span></div><div className="exercise-list">{data.exercises.filter(e=>e.isActive).map(e=><button className="card choice-card" key={e.id} disabled={workout.exercises.some(w=>w.exerciseId===e.id)} style={{opacity:workout.exercises.some(w=>w.exerciseId===e.id)?0.45:1}} onClick={()=>{if(workout.exercises.some(w=>w.exerciseId===e.id))return;addOneShot(e);setShowAdd(false);}}><span className="meta"><span className="choice-title">{e.name}</span><span className="choice-sub">{workoutTypeName(data,e.workoutTypeId)}</span></span><span className="chevron">›</span></button>)}</div></div></div>}
  <div className="workout-finish-bar"><button className="primary" onClick={editing?saveEdit:finish}>{editing?'Сохранить изменения':'Завершить тренировку'}</button></div>
  {showMeta && <WorkoutMetaEditor data={data} workout={workout} onClose={()=>setShowMeta(false)} onSave={w=>{onChange(w);setShowMeta(false)}}/>}
  {showDraftDeleteConfirm&&<div className="modal-backdrop" onClick={()=>setShowDraftDeleteConfirm(false)}><div className="modal confirm-modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-head"><h2>Удалить черновик?</h2><button className="icon-btn" onClick={()=>setShowDraftDeleteConfirm(false)}>×</button></div>
    <p className="muted">Незавершённая тренировка будет удалена из журнала. Вернуть её нельзя.</p>
    <div className="action-row" style={{marginTop:14}}>
      <button className="secondary" onClick={()=>setShowDraftDeleteConfirm(false)}>Отмена</button>
      <button className="primary danger-button" onClick={async()=>{await onDeleteDraft();setShowDraftDeleteConfirm(false)}}>Удалить</button>
    </div>
  </div></div>}
  {showReview && <div className="modal-backdrop" onClick={onHome}><div className="modal workout-review-modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-head"><h2>Тренировка завершена</h2><button className="icon-btn" onClick={onHome}>×</button></div>
    <div className="review-hero"><strong>{reviewStats.sets}</strong><span>подходов</span></div>
    <div className="review-grid">
      <div><strong>{reviewStats.exercises}</strong><span>упражнений</span></div>
      <div><strong>{reviewStats.totalReps}</strong><span>повторов</span></div>
      <div><strong>{Math.round(reviewStats.volume).toLocaleString('ru-RU')}</strong><span>кг объёма</span></div>
    </div>
    <button className="primary" style={{width:'100%',marginTop:18}} onClick={onHome}>Готово</button>
  </div></div>}
 </div>
}

function ExerciseCard({data,workout,we,ex,open,setOpen,onUpdate,onMove,onSkip,onDelete,onTimer,onClose}:{data:AppData;workout:Workout;we:WorkoutExercise;ex:Exercise;open:boolean;setOpen:()=>void;onUpdate:(p:Partial<WorkoutExercise>)=>void;onMove:(d:-1|1)=>void;onSkip:()=>void;onDelete:()=>void;onTimer:(s:number)=>void;onClose:()=>void}){
 const [weight,setWeight]=useState<string>(()=>{const prev=we.sets[we.sets.length-1]?.weight;return prev==null||prev===0?'':String(prev)});
 const [reps,setReps]=useState<string>('');
 const [comment,setComment]=useState('');
 const [menu,setMenu]=useState(false);
 const [pendingSetDelete,setPendingSetDelete]=useState<string|null>(null);
 const [pendingExerciseDelete,setPendingExerciseDelete]=useState(false);
 const hist=latestTwoExecutions(data,workout.typeId,ex.id);
 const loadType:LoadType=we.loadType ?? (ex.loadType==='bodyweight'?'bodyweight':'weight');
 const bodyweight=loadType==='bodyweight';

 useEffect(()=>{
   const prev=we.sets[we.sets.length-1]?.weight;
   if(prev!=null&&prev!==0)setWeight(String(prev));
 },[we.sets.length]);

 const changeLoadType=(next:LoadType)=>{
   const normalized:LoadType=next==='bodyweight'?'bodyweight':'weight';
   onUpdate({loadType:normalized});
   if(normalized==='weight'){
     const prev=we.sets.slice().reverse().find(s=>s.weight!=null&&s.weight!==0);
     setWeight(prev?String(prev.weight):'');
   }else{
     setWeight('');
   }
 };

 const saveSet=()=>{
   const w=bodyweight ? 0 : (weight.trim()===''?null:Number(weight.replace(',','.')));
   const r=reps.trim()===''?null:Number(reps.replace(',','.'));
   if(r===null || Number.isNaN(r)){ haptic('error'); return; }
   const s:SetEntry={id:uid(),order:we.sets.length+1,weight:w,reps:r,loadType:bodyweight?'bodyweight':'weight',comment:comment.trim()||undefined};
   onUpdate({sets:[...we.sets,s]});
   setReps('');
   setComment('');
   haptic();
   if(data.settings?.restTimerEnabled!==false) onTimer(data.settings?.restTimerSeconds ?? 120);
 };

 const copyLast=()=>{
   const p=we.sets.at(-1);
   if(!p)return;
   setWeight(p.weight==null||p.weight===0?'':String(p.weight));
   setReps(p.reps==null?'':String(p.reps));
   setComment(p.comment??'');
   haptic();
 };

 return <div className="card exercise-card">
  <div className="exercise-head"><button style={{background:'transparent',color:'inherit',padding:0,textAlign:'left',cursor:'pointer'}} onClick={setOpen}><div className="exercise-name">{ex.name}</div><div className="muted" style={{fontSize:12,marginTop:3}}>{we.skipped?'Пропущено':we.sets.length+' подходов'}</div></button>
    <div className="exercise-actions"><button className="icon-btn" title="выше" onClick={()=>onMove(-1)}>↑</button><button className="icon-btn" title="ниже" onClick={()=>onMove(1)}>↓</button><button className="icon-btn" title="действия" onClick={()=>setMenu(v=>!v)}>•••</button>{menu&&<div className="exercise-menu"><button onClick={()=>{setOpen();setMenu(false)}}>Редактировать</button><button onClick={()=>{setPendingExerciseDelete(true);setMenu(false)}}>Удалить</button></div>}</div>
  </div>
  {hist.length>0 && <div className="history-strip"><div className="history-date">Последние тренировки</div>{hist.map(h=><div key={h.workout.id} style={{marginBottom:4}}><strong style={{fontSize:13}}>{formatDate(h.workout.date)}</strong> <span className="muted" style={{fontSize:12}}>·</span> <span style={{fontSize:13}}>{h.workoutExercise.sets.map(s=>s.loadType==='bodyweight'?'Собственный вес × '+formatReps(s.reps):formatWeight(s.weight)+'×'+formatReps(s.reps)).join(' · ')}</span></div>)}</div>}
  {open && !we.skipped && <>
    <div className="workout-load-picker">
      <div className="workout-load-title">Режим нагрузки</div>
      <div className="segmented compact">
        <button type="button" className={loadType==='weight'?'active':''} onClick={()=>changeLoadType('weight')}>С весом</button>
        <button type="button" className={loadType==='bodyweight'?'active':''} onClick={()=>changeLoadType('bodyweight')}>Собственный вес</button>
      </div>
    </div>
    {we.sets.length>0&&<div className="workout-load-note">Режим применяется к новым подходам. Сохранённые подходы сохраняют свой режим.</div>}
    <div style={{marginTop:8}}>{we.sets.map(s=><div key={s.id} className="set-line"><span className="set-num">{s.order}</span><span>{s.loadType==='bodyweight'?'Собственный вес':formatWeight(s.weight)+' кг'}</span><span>{formatReps(s.reps)} повт.</span><button className="icon-btn" onClick={()=>setPendingSetDelete(s.id)}>×</button></div>)}</div>
    {pendingSetDelete && <div className="modal-backdrop" onClick={()=>setPendingSetDelete(null)}><div className="modal confirm-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>Удалить подход?</h2><button className="icon-btn" onClick={()=>setPendingSetDelete(null)}>×</button></div><p className="muted">Этот подход будет удалён из тренировки.</p><div className="action-row" style={{marginTop:14}}><button className="secondary" onClick={()=>setPendingSetDelete(null)}>Отмена</button><button className="primary danger-button" onClick={()=>{onUpdate({sets:we.sets.filter(x=>x.id!==pendingSetDelete).map((x,i)=>({...x,order:i+1}))});setPendingSetDelete(null)}}>Удалить</button></div></div></div>}
    {pendingExerciseDelete && <div className="modal-backdrop" onClick={()=>setPendingExerciseDelete(false)}><div className="modal confirm-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>Удалить упражнение?</h2><button className="icon-btn" onClick={()=>setPendingExerciseDelete(false)}>×</button></div><p className="muted">Упражнение и все сохранённые подходы исчезнут из этой тренировки.</p><div className="action-row" style={{marginTop:14}}><button className="secondary" onClick={()=>setPendingExerciseDelete(false)}>Отмена</button><button className="primary danger-button" onClick={()=>{onDelete();setPendingExerciseDelete(false)}}>Удалить</button></div></div></div>}
    <div className="set-line" style={{gridTemplateColumns:'28px minmax(0,1fr) minmax(0,1fr) 36px',borderTop:we.sets.length?'1px solid rgba(128,128,128,.11)':'0'}}><span className="set-num">{we.sets.length+1}</span>{bodyweight?<span className="bodyweight-label">Собственный вес</span>:<input className="input" inputMode="decimal" placeholder="Вес" value={weight} onChange={e=>setWeight(e.target.value)}/>}<input className="input" inputMode="numeric" placeholder="Повторы" value={reps} onChange={e=>setReps(e.target.value)}/><button className="icon-btn" onClick={saveSet}>✓</button></div>
    <div className="set-actions"><button className="secondary" onClick={copyLast}>Скопировать</button><button className="secondary" onClick={()=>saveSet()}>+ Подход</button></div>
    <textarea className="input comment-input notes" placeholder="Комментарий к следующему подходу (необязательно)" value={comment} onChange={e=>setComment(e.target.value)}/>
    {we.notes && <div className="history-empty">Импортированная заметка: {we.notes}</div>}
    <button className="primary" style={{marginTop:10,width:'100%'}} onClick={onClose}>Готово</button>
  </>}
 </div>
}
function RestTimer({timer,onClose}:{timer:{until:number};onClose:()=>void}){
 const [until,setUntil]=useState(timer.until); const [left,setLeft]=useState(Math.max(0,timer.until-Date.now())); const [expired,setExpired]=useState(false); const notified=useRef(false);
 useEffect(()=>{const id=setInterval(()=>{const n=Math.max(0,until-Date.now());setLeft(n);if(n===0&&!expired){setExpired(true);haptic('success');if(!notified.current){notified.current=true;notifyTimerExpired().catch(()=>undefined);}}},250);return()=>clearInterval(id)},[until,expired]);
 return <div className={`timer-fab ${expired?'timer-expired':''}`}><div><div className="eyebrow">ОТДЫХ</div><div className="timer-time">{expired?'Время вышло':`${String(Math.floor(left/60000)).padStart(2,'0')}:${String(Math.floor((left%60000)/1000)).padStart(2,'0')}`}</div></div><div className="timer-controls"><button className="timer-btn" onClick={()=>{const n=until+30000;setExpired(false);notified.current=false;setUntil(n);setLeft(n-Date.now());}}>+30</button><button className="timer-btn" onClick={()=>{const n=Math.max(Date.now(),until-30000);setExpired(false);notified.current=false;setUntil(n);setLeft(n-Date.now());}}>−30</button><button className="timer-btn" onClick={onClose}>Готово</button></div></div>
}
function CalendarScreen({data,onOpen}:{data:AppData;onOpen:(w:Workout)=>void}){
 const [month,setMonth]=useState(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1)});
 const y=month.getFullYear(),m=month.getMonth(); const first=new Date(y,m,1); const start=(first.getDay()+6)%7; const days=new Date(y,m+1,0).getDate();
 const byDate=new Map(data.workouts.filter(w=>w.status==='completed').map(w=>[w.date,w]));
 const cells=[]; for(let i=0;i<start;i++)cells.push(<div key={'p'+i}/>); for(let d=1;d<=days;d++){const date=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const w=byDate.get(date);cells.push(<button key={date} className={`cal-day ${date===todayISO()?'today':''}`} onClick={()=>w&&onOpen(w)}>{d}{w&&<span className="cal-dot"/>}</button>)}
 return <div className="screen"><Top title="Календарь"/><div className="card"><div className="calendar-head"><button className="secondary" onClick={()=>setMonth(new Date(y,m-1,1))}>‹</button><strong>{month.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</strong><button className="secondary" onClick={()=>setMonth(new Date(y,m+1,1))}>›</button></div><div className="month-grid" style={{marginTop:12}}>{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(x=><div className="cal-day-name" key={x}>{x}</div>)}{cells}</div></div></div>
}

function HistoryScreen({data,workout,onEdit,onDuplicate,onRepeat,onDelete}:{data:AppData;workout:Workout;onEdit:()=>void;onDuplicate:()=>void;onRepeat:()=>void;onDelete:()=>void}){
 const [confirm,setConfirm]=useState(false);
 return <div className="screen"><Top title={workout.name || workoutTypeName(data,workout.typeId)} sub={formatLongDate(workout.date)}/>
  <div className="history-actions no-print"><button className="secondary" onClick={onEdit}>Редактировать</button><button className="secondary" onClick={onRepeat}>Повторить</button><button className="secondary" onClick={onDuplicate}>Дублировать</button><button className="secondary danger-outline" onClick={()=>setConfirm(true)}>Удалить</button></div>
  {confirm&&<div className="modal-backdrop" onClick={()=>setConfirm(false)}><div className="modal confirm-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>Удалить тренировку?</h2><button className="icon-btn" onClick={()=>setConfirm(false)}>×</button></div><p className="muted">Запись будет удалена из журнала.</p><div className="action-row" style={{marginTop:14}}><button className="secondary" onClick={()=>setConfirm(false)}>Отмена</button><button className="primary danger-button" onClick={()=>{onDelete();setConfirm(false)}}>Удалить</button></div></div></div>}
  {[...workout.exercises].sort((a,b)=>a.order-b.order).filter(we=>we.sets.length>0).map(we=>{const ex=data.exercises.find(e=>e.id===we.exerciseId);if(!ex)return null;return <div className="card" key={we.id}><div className="exercise-name">{ex.name}</div>{we.sets.map(s=><div key={s.id} className="summary-row"><span>Подход {s.order}</span><span className="summary-result">{(s.loadType ?? we.loadType ?? ex.loadType)==='bodyweight'?'Собственный вес × '+formatReps(s.reps)+' повт.':formatWeight(s.weight)+' кг × '+formatReps(s.reps)}</span></div>)}{we.notes&&<div className="history-empty">{we.notes}</div>}</div>})}
 </div>
}
function SummaryScreen({data}:{data:AppData}){
 const [exercise,setExercise]=useState('all'); const [from,setFrom]=useState(''); const [to,setTo]=useState('');
 const active=data.exercises.filter(e=>e.isActive).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
 const completed=data.workouts.filter(w=>w.status==='completed'&&(!from||w.date>=from)&&(!to||w.date<=to));
 const stats=active.map(ex=>{const points=completed.flatMap(w=>w.exercises.filter(we=>we.exerciseId===ex.id&&!we.skipped&&we.sets.length).flatMap(we=>we.sets.map(s=>({date:w.date,weight:s.weight,reps:s.reps,bodyweight:(s.loadType ?? we.loadType ?? ex.loadType)==='bodyweight'}))));const weighted=points.filter(p=>!p.bodyweight&&p.weight!=null&&p.reps!=null);const best=weighted.reduce((a,p)=>!a||Number(p.weight)>Number(a.weight)||(Number(p.weight)===Number(a.weight)&&Number(p.reps)>Number(a.reps))?p:a,null as typeof weighted[number]|null);return {ex,points,best};});
 const selected=exercise==='all'?null:stats.find(x=>x.ex.id===exercise);
 const exportData={...data,workouts:completed};
 const exportXlsx=async()=>{try{const rows=buildExportRows(exportData);const ws=XLSX.utils.aoa_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Тренировки');const bytes=XLSX.write(wb,{bookType:'xlsx',type:'array'});await shareOrDownloadFile(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'gym-log-'+(from||'all')+'-'+(to||todayISO())+'.xlsx');}catch(e){console.error(e);}};
 const exportCsv=async()=>{try{const rows=buildExportRows(exportData).map(r=>r.map(csvEscape).join(';')).join('\n');await shareOrDownloadFile(new Blob(['\uFEFF'+rows],{type:'text/csv;charset=utf-8'}),'gym-log-'+(from||'all')+'-'+(to||todayISO())+'.csv');}catch(e){console.error(e);}};
 const exportPdf=async()=>{try{await exportWorkoutsPdf(exportData,from,to)}catch(e){console.error(e);}};
 return <div className="screen"><Top title="Прогресс" sub="История и рост рабочих весов"/>
  <div className="card progress-hero"><div className="progress-kicker">ТРЕНИРОВКИ</div><div className="progress-big">{completed.length}</div><div className="muted">завершённых тренировок</div></div>
  <div className="card"><div className="section-title"><h2>Упражнения</h2></div><select className="input progress-select" value={exercise} onChange={e=>setExercise(e.target.value)}><option value="all">Все упражнения</option>{active.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
  {selected?<ProgressExerciseCard stat={selected}/>:<div className="summary-group">{stats.filter(x=>x.points.length).slice(0,8).map(x=><ProgressExerciseCard key={x.ex.id} stat={x}/>)}</div>}
  <div className="card export-card"><div className="section-title"><h2>Выгрузка</h2></div><div className="muted export-period">Период выгрузки</div><DateRangePicker from={from} to={to} onChange={(a,b)=>{setFrom(a);setTo(b)}}/>
   <div className="tool-row no-print" style={{marginTop:12}}><button className="tool" onClick={exportXlsx}><strong>Excel</strong><small>.xlsx</small></button><button className="tool" onClick={exportCsv}><strong>CSV</strong><small>.csv</small></button><button className="tool" onClick={exportPdf}><strong>PDF</strong><small>.pdf</small></button></div>
  </div>
 </div>;
}
function DateRangePicker({from,to,onChange}:{from:string;to:string;onChange:(from:string,to:string)=>void}){
 const [open,setOpen]=useState(false); const [mode,setMode]=useState<'from'|'to'>('from');
 const initial=from||to||todayISO(); const parsed=new Date(initial+'T12:00:00');
 const [month,setMonth]=useState(()=>new Date(parsed.getFullYear(),parsed.getMonth(),1));
 const openPicker=(m:'from'|'to')=>{setMode(m);const value=m==='from'?from:to;const d=value?new Date(value+'T12:00:00'):new Date();setMonth(new Date(d.getFullYear(),d.getMonth(),1));setOpen(true)};
 const selectDate=(date:string)=>{if(mode==='from'){if(to&&date>to)onChange(date,'');else onChange(date,to);setMode('to');}else{if(from&&date<from){onChange(date,from);setMode('to');}else{onChange(from,date);setOpen(false);}}};
 const y=month.getFullYear(),m=month.getMonth(),first=new Date(y,m,1),start=(first.getDay()+6)%7,days=new Date(y,m+1,0).getDate();
 const cells=[];for(let i=0;i<start;i++)cells.push(<div key={'p'+i}/>);
 for(let d=1;d<=days;d++){const date=y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');const selected=date===from||date===to;const inRange=!!from&&!!to&&date>from&&date<to;cells.push(<button key={date} className={'range-day '+(selected?'selected ':'')+(inRange?'in-range':'')} onClick={()=>selectDate(date)}>{d}</button>)}
 const label=(v:string,empty:string)=>v?new Date(v+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'}):empty;
 return <>
  <div className="date-range-picker"><button className={'date-range-field '+(mode==='from'&&open?'active':'')} onClick={()=>openPicker('from')}><span>От</span><strong>{label(from,'Не выбрано')}</strong></button><div className="date-range-arrow">→</div><button className={'date-range-field '+(mode==='to'&&open?'active':'')} onClick={()=>openPicker('to')}><span>До</span><strong>{label(to,'Не выбрано')}</strong></button></div>
  {(from||to)&&<button className="date-clear" onClick={()=>onChange('','')}>Сбросить период</button>}
  {open&&<div className="modal-backdrop" onClick={()=>setOpen(false)}><div className="modal date-picker-modal" onClick={e=>e.stopPropagation()}>
   <div className="modal-head"><div><h2>{mode==='from'?'Начало периода':'Конец периода'}</h2><div className="muted">Выберите дату</div></div><button className="icon-btn" onClick={()=>setOpen(false)}>×</button></div>
   <div className="calendar-head"><button className="secondary" onClick={()=>setMonth(new Date(y,m-1,1))}>‹</button><strong>{month.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</strong><button className="secondary" onClick={()=>setMonth(new Date(y,m+1,1))}>›</button></div>
   <div className="month-grid range-calendar">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(x=><div className="cal-day-name" key={x}>{x}</div>)}{cells}</div>
  </div></div>}
 </>;
}
async function exportWorkoutsPdf(data:AppData,from:string,to:string){
 const workouts=data.workouts.filter(w=>w.status==='completed'&&(!from||w.date>=from)&&(!to||w.date<=to)).sort((a,b)=>a.date.localeCompare(b.date));
 const W=1240,H=1754,M=78;
 const pages:string[][]=[]; let lines:string[]=[];
 const add=(s:string='')=>{lines.push(s)};
 add('GYM TRACKER'); add('ТРЕНИРОВКИ'); add(from||to?`Период: ${from?formatDate(from):'все'} — ${to?formatDate(to):'сегодня'}`:'Весь период'); add('');
 workouts.forEach(w=>{
   add(`${formatDate(w.date)} · ${w.name||workoutTypeName(data,w.typeId)}`);
   w.exercises.filter(we=>!we.skipped&&we.sets.length).forEach(we=>{
     const ex=data.exercises.find(e=>e.id===we.exerciseId);
     add(`  ${ex?.name||'Упражнение'}`);
     we.sets.forEach((s,i)=>{
       const body=(s.loadType??we.loadType??ex?.loadType)==='bodyweight';
       add(`    ${i+1}. ${body?'Собственный вес':(s.weight!=null?`${formatWeight(s.weight)} кг`:'—')} × ${s.reps!=null?formatReps(s.reps):'—'}`);
     });
     if(we.notes) add(`    Заметка: ${we.notes}`);
   });
   add('');
 });
 if(!workouts.length) add('За выбранный период тренировок нет.');
 const lineH=34, top=110, bottom=95, usable=Math.floor((H-top-bottom)/lineH);
 for(let i=0;i<lines.length;i+=usable) pages.push(lines.slice(i,i+usable));
 const pdfPages=pages.map(chunk=>makePdfPage(chunk,W,H,M));
 const pdf=buildImagePdf(pdfPages,W,H);
 await shareOrDownloadFile(pdf,'gym-log-'+(from||'all')+'-'+(to||todayISO())+'.pdf');
}
function makePdfPage(lines:string[],W:number,H:number,M:number){
 const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
 const ctx=canvas.getContext('2d'); if(!ctx) throw new Error('Canvas unavailable');
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);ctx.fillStyle='#111111';
 let y=90;
 lines.forEach((line,i)=>{
   const heading=i===0; ctx.font=heading?'800 34px Arial':'400 22px Arial';
   ctx.fillStyle=heading?'#111111':'#333333';
   ctx.fillText(line,M,y); y+=34;
 });
 return canvas.toDataURL('image/jpeg',0.9);
}
function buildImagePdf(images:string[],W:number,H:number){
 const enc=new TextEncoder(); const objects:string[]=[]; const binaries:Uint8Array[]=[];
 const addObj=(body:string)=>{objects.push(body);return objects.length};
 const pagesId=addObj(''); const catalogId=addObj('');
 const pageIds:number[]=[];
 images.forEach((dataUrl)=>{
   const b64=dataUrl.split(',')[1]; const bin=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
   const imgId=addObj(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bin.length} >>\nstream\n`);
   binaries.push(bin);
   const content=`q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`;
   const contentId=addObj(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`);
   const pageId=addObj(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`);
   pageIds.push(pageId);
 });
 objects[pagesId-1]=`<< /Type /Pages /Kids [${pageIds.map(id=>id+' 0 R').join(' ')}] /Count ${pageIds.length} >>`;
 objects[catalogId-1]=`<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
 const chunks:Uint8Array[]=[enc.encode('%PDF-1.4\n')]; const offsets:number[]=[0]; let offset=chunks[0].length; let binaryIndex=0;
 objects.forEach((body,idx)=>{
   const id=idx+1; const head=enc.encode(`${id} 0 obj\n`);
   chunks.push(head); offset+=head.length; offsets[id]=offset;
   if(binaries[binaryIndex]&&body.includes('/Subtype /Image')){const bin=binaries[binaryIndex++]; const pre=enc.encode(body); chunks.push(pre); offset+=pre.length; chunks.push(bin); offset+=bin.length; const tail=enc.encode('\nendstream\nendobj\n');chunks.push(tail);offset+=tail.length;}
   else {const part=enc.encode(body+'\nendobj\n');chunks.push(part);offset+=part.length;}
 });
 const xrefOffset=offset; const xref=[enc.encode(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`)];
 for(let i=1;i<=objects.length;i++) xref.push(enc.encode(String(offsets[i]).padStart(10,'0')+' 00000 n \n'));
 xref.push(enc.encode(`trailer\n<< /Size ${objects.length+1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
 chunks.push(...xref);
 const total=chunks.reduce((n,x)=>n+x.length,0); const out=new Uint8Array(total); let p=0; chunks.forEach(x=>{out.set(x,p);p+=x.length});
 return new Blob([out],{type:'application/pdf'});
}
async function shareOrDownloadFile(blob:Blob,filename:string){
 const file=new File([blob],filename,{type:blob.type});
 const nav=navigator as Navigator & {share?: (data?:ShareData)=>Promise<void>;canShare?: (data?:ShareData)=>boolean};
 if(nav.share&&(!nav.canShare||nav.canShare({files:[file]}))){await nav.share({files:[file],title:filename});return;}
 const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function ProgressExerciseCard({stat}:{stat:{ex:Exercise;points:Array<{date:string;weight:number|null;reps:number|null;bodyweight?:boolean}>;best:{date:string;weight:number|null;reps:number|null;bodyweight?:boolean}|null}}){
 const recent=stat.points.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4); const weighted=stat.points.filter(p=>p.weight!=null).slice().sort((a,b)=>a.date.localeCompare(b.date)); const min=weighted.length?Math.min(...weighted.map(p=>Number(p.weight))):0; const max=weighted.length?Math.max(...weighted.map(p=>Number(p.weight))):0;
 return <div className="card progress-card"><div className="progress-card-head"><div><div className="exercise-name">{stat.ex.name}</div><div className="muted">{stat.points.length} подходов</div></div>{stat.best&&<div className="record-badge"><span>ЛУЧШИЙ</span><strong>{formatWeight(stat.best.weight)} кг × {formatReps(stat.best.reps)}</strong></div>}</div><div className="mini-chart">{weighted.slice(-12).map((p,i)=><div className="chart-col" key={i}><div className="chart-bar" style={{height:`${max===min?48:18+((Number(p.weight)-min)/(max-min))*62}px`}}/><span>{formatWeight(p.weight)}</span></div>)}</div><div className="recent-results">{recent.map((p,i)=><div className="summary-row" key={i}><span>{formatDate(p.date)}</span><span className="summary-result">{p.bodyweight?'Собственный вес × '+formatReps(p.reps):formatWeight(p.weight)+' кг × '+formatReps(p.reps)}</span></div>)}</div></div>;
}
function SettingsScreen({data,onChange}:{data:AppData;onChange:(d:AppData)=>Promise<void>|void}){
 const [addName,setAddName]=useState('');
 const [target,setTarget]=useState<WorkoutTypeId>(data.workoutTypes[0]?.id ?? '');
 const [draggingId,setDraggingId]=useState<string|null>(null);
 const [dirty,setDirty]=useState(false);
 const [savedFlash,setSavedFlash]=useState(false);
 const dragId=useRef<string|null>(null);
 const settings=data.settings ?? {restTimerSeconds:120,restTimerEnabled:true,theme:'dark' as const,accentColor:'red' as const};
 const activeFor=(typeId:WorkoutTypeId)=>data.exercises.filter(e=>e.workoutTypeId===typeId&&e.isActive).sort((a,b)=>a.sortOrder-b.sortOrder);
 const [draftExercises,setDraftExercises]=useState<Exercise[]>(()=>activeFor(target).map(e=>({...e})));

 useEffect(()=>{
   if(!dirty) setDraftExercises(activeFor(target).map(e=>({...e})));
 },[data.exercises,target,dirty]);

 const updateSettings=(patch:Partial<typeof settings>)=>onChange({...data,settings:{...settings,...patch}});

 const saveTemplate=async()=>{
   const existingById=new Map(data.exercises.map(e=>[e.id,e]));
   const updated=data.exercises.map(e=>{
     if(e.workoutTypeId!==target)return e;
     const draft=draftExercises.find(x=>x.id===e.id);
     return draft?{...draft,sortOrder:draftExercises.findIndex(x=>x.id===draft.id)+1,isActive:true}:{...e,isActive:false};
   });
   const newExercises=draftExercises
     .filter(e=>!existingById.has(e.id))
     .map((e,i)=>({...e,sortOrder:i+1,isActive:true}));
   const next={...data,exercises:[...updated,...newExercises]};
   await onChange(next);
   setDraftExercises(draftExercises.map((e,i)=>({...e,sortOrder:i+1,isActive:true})));
   setDirty(false);
   setSavedFlash(true);
   window.setTimeout(()=>setSavedFlash(false),1400);
 };

 const switchTemplate=(nextTarget:WorkoutTypeId)=>{
   if(nextTarget===target)return;
   if(dirty)void saveTemplate();
   setTarget(nextTarget);
   setDraftExercises(activeFor(nextTarget).map(e=>({...e})));
   setDirty(false);
 };

 const add=()=>{
   const name=addName.trim();
   if(!name)return;
   const existing=draftExercises.find(e=>e.name.trim().toLowerCase()===name.toLowerCase());
   if(existing){setAddName('');return;}
   const ex:Exercise={id:uid(),name,workoutTypeId:target,loadType:'weight',sortOrder:draftExercises.length+1,isActive:true};
   setDraftExercises(v=>[...v,ex]);
   setDirty(true);
   setSavedFlash(false);
   setAddName('');
 };

 const remove=(id:string)=>{
   setDraftExercises(v=>v.filter(x=>x.id!==id).map((x,i)=>({...x,sortOrder:i+1})));
   setDirty(true);
   setSavedFlash(false);
 };

 const reorder=(fromId:string,toId:string)=>{
   if(fromId===toId)return;
   setDraftExercises(prev=>{
     const arr=[...prev];
     const from=arr.findIndex(x=>x.id===fromId),to=arr.findIndex(x=>x.id===toId);
     if(from<0||to<0)return prev;
     const [item]=arr.splice(from,1);
     arr.splice(to,0,item);
     return arr.map((x,i)=>({...x,sortOrder:i+1}));
   });
   setDirty(true);
   setSavedFlash(false);
 };

 const setLoadType=(id:string,loadType:LoadType)=>{
   setDraftExercises(v=>v.map(e=>e.id===id?{...e,loadType}:e));
   setDirty(true);
   setSavedFlash(false);
 };

 const startDrag=(id:string,e:React.PointerEvent)=>{
   if(e.pointerType==='mouse'&&e.button!==0)return;
   e.preventDefault();
   dragId.current=id;
   setDraggingId(id);
   haptic();
   (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
 };
 const moveDrag=(e:PointerEvent|React.PointerEvent)=>{
   if(!dragId.current)return;
   e.preventDefault();
   const el=document.elementFromPoint(e.clientX,e.clientY)?.closest('.settings-item') as HTMLElement|null;
   const overId=el?.dataset.id;
   if(overId&&overId!==dragId.current)reorder(dragId.current,overId);
 };
 const endDrag=()=>{dragId.current=null;setDraggingId(null);document.body.style.overflow='';document.body.style.touchAction=''};

 useEffect(()=>{
   if(!draggingId)return;
   const move=(e:PointerEvent)=>moveDrag(e);
   const end=()=>endDrag();
   document.addEventListener('pointermove',move,{passive:false});
   document.addEventListener('pointerup',end,{passive:false});
   document.addEventListener('pointercancel',end,{passive:false});
   document.body.style.overflow='hidden';
   document.body.style.touchAction='none';
   return()=>{
     document.removeEventListener('pointermove',move);
     document.removeEventListener('pointerup',end);
     document.removeEventListener('pointercancel',end);
     document.body.style.overflow='';
     document.body.style.touchAction='';
   };
 },[draggingId]);

 const accentOptions=[['red','Красный','#ff375f'],['pink','Розовый','#ff2d55'],['purple','Фиолетовый','#af52de'],['blue','Синий','#0a84ff'],['teal','Бирюзовый','#14b8a6'],['green','Зелёный','#30d158'],['orange','Оранжевый','#ff9f0a']] as const;

 if(!target)return <div className="screen"><Top title="Настройки" sub="Приложение и шаблоны"/><div className="card muted">Нет доступных шаблонов.</div></div>;

 return <div className="screen"><Top title="Настройки" sub="Приложение и шаблоны"/>
  <div className="card settings-group"><div className="settings-section-title">ОФОРМЛЕНИЕ</div>
   <div className="settings-item"><div><strong>Тема</strong></div><div className="segmented compact"><button className={settings.theme==='light'?'active':''} onClick={()=>updateSettings({theme:'light'})}>Белая</button><button className={settings.theme==='dark'?'active':''} onClick={()=>updateSettings({theme:'dark'})}>Чёрная</button></div></div>
   <div className="accent-picker"><div className="accent-picker-title">Акцентный цвет</div><div className="accent-options">{accentOptions.map(([id,name,color])=><button key={id} title={name} aria-label={name} className={'accent-swatch '+(settings.accentColor===id?'selected':'')} style={{'--swatch':color} as React.CSSProperties} onClick={()=>updateSettings({accentColor:id})}><span/></button>)}</div></div>
  </div>
  <div className="card settings-group"><div className="settings-section-title">ТАЙМЕР ОТДЫХА</div>
   <div className="settings-item timer-setting"><div><strong>Таймер после подхода</strong><div className="muted">{settings.restTimerEnabled?'Запускается автоматически':'Таймер отключён'}</div></div><button className={'ios-switch '+(settings.restTimerEnabled?'on':'')} aria-label="Таймер отдыха" onClick={()=>updateSettings({restTimerEnabled:!settings.restTimerEnabled})}><span/></button></div>
   {settings.restTimerEnabled&&<div className="settings-item timer-setting"><div><strong>Длительность</strong><div className="muted">Шаг 30 секунд</div></div><select className="input timer-select" value={settings.restTimerSeconds} onChange={e=>updateSettings({restTimerSeconds:Number(e.target.value)})}>{Array.from({length:20},(_,i)=>(i+1)*30).map(s=><option key={s} value={s}>{Math.floor(s/60)}:{String(s%60).padStart(2,'0')}</option>)}</select></div>}
  </div>
  <div className="card">
   <div className="settings-section-title">УПРАЖНЕНИЯ</div>
   <div className="segmented">{data.workoutTypes.map(t=><button key={t.id} className={target===t.id?'active':''} onClick={()=>switchTemplate(t.id)}>{t.name}</button>)}</div>
   <div className="settings-list">
    {draftExercises.map(ex=><div className={'settings-item '+(draggingId===ex.id?'is-dragging':'')} data-id={ex.id} key={ex.id} onPointerDown={e=>startDrag(ex.id,e)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <span className="settings-drag-hint" aria-hidden="true">≡</span>
      <span className="settings-name">{ex.name}</span>
      <div className="load-type-segmented" onPointerDown={e=>e.stopPropagation()}>
        <button type="button" className={ex.loadType!=='bodyweight'?'active':''} onClick={()=>setLoadType(ex.id,'weight')}>С весом</button>
        <button type="button" className={ex.loadType==='bodyweight'?'active':''} onClick={()=>setLoadType(ex.id,'bodyweight')}>Без веса</button>
      </div>
      <button className="settings-delete" aria-label={'Удалить '+ex.name+' из шаблона'} onPointerDown={e=>e.stopPropagation()} onClick={()=>remove(ex.id)}>−</button>
    </div>)}
   </div>
   <div className="settings-tip">«Без веса» — в тренировке записываются только подходы и повторения. Режим можно изменить и внутри конкретной тренировки.</div>
   <div className="settings-add-exercise"><div className="exercise-name">Добавить упражнение</div><div className="form-grid" style={{marginTop:10}}><input className="input" value={addName} onChange={e=>setAddName(e.target.value)} placeholder="Название упражнения"/><button className="secondary" onClick={add}>Добавить в шаблон</button></div><div className="muted" style={{fontSize:12,marginTop:8}}>Изменение попадёт в шаблон после нажатия «Сохранить».</div></div>
   <div className="settings-save-row"><div>{savedFlash?<span className="settings-saved">Сохранено</span>:dirty?<span className="settings-unsaved">Есть несохранённые изменения</span>:<span className="settings-saved">Все изменения сохранены</span>}</div><button className="primary settings-save-button" disabled={!dirty} onClick={()=>void saveTemplate()}>Сохранить</button></div>
  </div>
 </div>
}
function WorkoutMetaEditor({data,workout,onClose,onSave}:{data:AppData;workout:Workout;onClose:()=>void;onSave:(w:Workout)=>void}){
 const [date,setDate]=useState(workout.date); const [name,setName]=useState(workout.name??''); const [type,setType]=useState(workout.typeId);
 return <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>Данные тренировки</h2><button className="icon-btn" onClick={onClose}>×</button></div><div className="form-grid"><label className="field-label">Название<input className="input" value={name} onChange={e=>setName(e.target.value)} placeholder={workoutTypeName(data,type)}/></label><label className="field-label">Тип<select className="input" value={type} onChange={e=>setType(e.target.value as WorkoutTypeId)}>{data.workoutTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="field-label">Дата<input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button className="primary" onClick={()=>onSave({...workout,name:name.trim()||undefined,typeId:type,date})}>Сохранить</button></div></div></div>
}

function NotFound(){return <div className="card">Не найдено.</div>}


createRoot(document.getElementById('root')!).render(<App/>);
