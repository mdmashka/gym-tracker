import type { AppData, Exercise, SetEntry, Workout, WorkoutExercise, WorkoutTypeId } from './types';

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
export const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export function formatDate(date: string) {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}
export function formatLongDate(date: string) {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString('ru-RU', { day:'numeric', month:'long' });
}
export function formatWeight(weight: number | null) {
  if (weight === null || Number.isNaN(weight)) return '—';
  return Number.isInteger(weight) ? String(weight) : String(Number(weight.toFixed(2)));
}
export function formatReps(reps: number | null) {
  return reps === null || Number.isNaN(reps) ? '—' : String(Number.isInteger(reps) ? reps : reps);
}
export function workoutTypeName(data: AppData, id: WorkoutTypeId) {
  return data.workoutTypes.find(x => x.id === id)?.name ?? id;
}
export function getExercisesForType(data: AppData, typeId: WorkoutTypeId) {
  return data.exercises.filter(x => x.workoutTypeId === typeId && x.isActive).sort((a,b)=>a.sortOrder-b.sortOrder);
}
export function completedWorkoutsForType(data: AppData, typeId: WorkoutTypeId) {
  return data.workouts.filter(w=>w.typeId===typeId && w.status==='completed').sort((a,b)=>b.date.localeCompare(a.date));
}
export function lastGroupWorkouts(data: AppData, typeId: WorkoutTypeId, count=2) {
  return completedWorkoutsForType(data,typeId).slice(0,count);
}
export function lastExecution(data: AppData, typeId: WorkoutTypeId, exerciseId: string) {
  for (const workout of completedWorkoutsForType(data,typeId)) {
    const we = workout.exercises.find(x=>x.exerciseId===exerciseId && !x.skipped && x.sets.length);
    if (we) return { workout, workoutExercise: we };
  }
  return null;
}
export function latestTwoExecutions(data: AppData, typeId: WorkoutTypeId, exerciseId: string) {
  const out: Array<{workout:Workout;workoutExercise:WorkoutExercise}> = [];
  for (const workout of completedWorkoutsForType(data,typeId)) {
    const we = workout.exercises.find(x=>x.exerciseId===exerciseId && !x.skipped && x.sets.length);
    if (we) out.push({workout,workoutExercise:we});
    if (out.length===2) break;
  }
  return out;
}
export function startWorkout(data: AppData, typeId: WorkoutTypeId): Workout {
  const exercises = getExercisesForType(data,typeId).map((e,idx)=>({
    id: uid(), exerciseId:e.id, order:idx+1, skipped:false, loadType:e.loadType==='bodyweight'?'bodyweight':'weight', sets:[]
  }));
  const now = new Date().toISOString();
  return { id: uid(), typeId, date:todayISO(), status:'draft', createdAt:now, updatedAt:now, exercises };
}
export function ensureWorkoutExercises(workout: Workout, data: AppData): Workout {
  const known = new Set(workout.exercises.map(e=>e.exerciseId));
  const max = workout.exercises.reduce((m,e)=>Math.max(m,e.order),0);
  const extras = getExercisesForType(data,workout.typeId).filter(e=>!known.has(e.id)).map((e,i)=>({id:uid(),exerciseId:e.id,order:max+i+1,skipped:false,loadType:e.loadType==='bodyweight'?'bodyweight':'weight',sets:[]}));
  return extras.length ? {...workout,exercises:[...workout.exercises,...extras]} : workout;
}
export function setSummary(we: WorkoutExercise) {
  return we.sets.map((s:SetEntry)=>`${formatWeight(s.weight)}×${formatReps(s.reps)}`).join(', ');
}
export function csvEscape(s: string) {
  return `"${s.replaceAll('"','""')}"`;
}
export function downloadText(filename:string, content:string, type='text/plain;charset=utf-8') {
  const blob=new Blob([content],{type}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
export function buildExportRows(data:AppData) {
  const rows:[string,string,string,string,string,string,string][]=[];
  rows.push(['Дата','Тренировка','Упражнение','Подход','Вес','Повторы','Комментарий']);
  for (const w of [...data.workouts].sort((a,b)=>a.date.localeCompare(b.date))) {
    const type=workoutTypeName(data,w.typeId);
    for(const we of [...w.exercises].sort((a,b)=>a.order-b.order)){
      const ex=data.exercises.find(e=>e.id===we.exerciseId);
      if(!ex) continue;
      if(we.skipped && !we.sets.length){ rows.push([w.date,type,ex.name,'','','',we.notes??'Пропущено']); continue; }
      we.sets.forEach((s,i)=>rows.push([w.date,type,ex.name,String(i+1),formatWeight(s.weight),formatReps(s.reps),s.comment??'']));
    }
  }
  return rows;
}
