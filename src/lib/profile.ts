import {useEffect,useState} from 'react'
import {BRIDGE_HTTP_URL} from '../config'
type ClientProfile={displayName:string;city:string;timezone:string;addressAs:string;prepareAt:string;readyBy:string;playbackMode:'on_request';automaticPlayback:boolean}
const fallback:ClientProfile={displayName:'SEU ASSISTENTE',city:'',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,addressAs:'senhor',prepareAt:'06:25',readyBy:'06:55',playbackMode:'on_request',automaticPlayback:false}
let current=fallback
export const clientProfile=()=>current
export function useClientProfile(){
  const [profile,setProfile]=useState(fallback)
  useEffect(()=>{const controller=new AbortController();void fetch(BRIDGE_HTTP_URL+'/client-profile',{signal:controller.signal}).then(r=>r.ok?r.json():Promise.reject()).then(p=>{current={...fallback,...p};setProfile(current)}).catch(()=>{});return()=>controller.abort()},[])
  return profile
}
