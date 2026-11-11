// Workspace changes never replace the shared composition, camera or motion playhead.
import {timelineAt} from './motion.mjs?v=20261111-motion-core';
export function frameForWorkspace(progress,state){
  if(state.workspace==='motion')return timelineAt(progress,state);
  return {...timelineAt(0,{...state,sequence:'orbit'}),phase:'Fully grown',turn:0};
}
export function switchWorkspace(state,workspace){
  return {...state,workspace:workspace==='motion'?'motion':'still',autoOrbit:false};
}
export function exportContext(state){
  return state.workspace==='motion'?{tab:'video',label:'Export animation',imageLabel:'Current frame',description:`Frame at ${(state.progress*state.duration).toFixed(2)} s. Exports the paused motion frame and camera.`}:{tab:'still',label:'Export still',imageLabel:'Image',description:'Fully grown artwork with your current camera, colors, and finish.'};
}
