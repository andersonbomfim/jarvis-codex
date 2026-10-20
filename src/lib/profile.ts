import {useEffect,useState} from 'react'
import {BRIDGE_HTTP_URL} from '../config'
type ClientProfile={displayName:string;city:string;timezone:string;addressAs:string;deliverAt:string;lateAudioCutoff:string}
const fallback:ClientProfile={displayName:'SEU ASSISTENTE',city:'',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,addressAs:'senhor',deliverAt:'07:00',lateAudioCutoff:'07:30'}
let current=fallback
export const clientProfile=()=>current
export function useClientProfile(){
  const [profile,setProfile]=useState(fallback)
  useEffect(()=>{const controller=new AbortController();void fetch(BRIDGE_HTTP_URL+'/client-profile',{signal:controller.signal}).then(r=>r.ok?r.json():Promise.reject()).then(p=>{current={...fallback,...p};setProfile(current)}).catch(()=>{});return()=>controller.abort()},[])
  return profile
}
