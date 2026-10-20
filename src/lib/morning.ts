import {clientProfile} from './profile'
export type MorningBriefing = {
  date: string; due: boolean; text: string; status: string; delivered: boolean; audioUrl: string | null; inProgress?: boolean; retryAt?: string | null
}

/** Poll locally; never ask an AI or synthesize a second copy of the briefing. */
export function startMorningBriefing(baseUrl: string, available: () => boolean, deliver: (briefing: MorningBriefing, signal: AbortSignal) => Promise<boolean | 'cancelled'>) {
  let stopped = false, checking = false
  let active: AbortController | null = null
  const ackKey='jarvis.morning.ack.v2'
  const acknowledge=async()=>{
    const raw=localStorage.getItem(ackKey);if(!raw)return
    let ack:{date:string;token:string;status:string}
    try { ack=JSON.parse(raw); if(!ack.date||!ack.token||!ack.status)throw Error('invalid') } catch { localStorage.removeItem(ackKey);return }
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:clientProfile().timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
    if(ack.date!==date){localStorage.removeItem(ackKey);return}
    const response=await fetch(baseUrl+'/morning-briefing/finished?'+new URLSearchParams(ack),{method:'POST',signal:AbortSignal.timeout(5000)})
    if(response.ok||response.status===409)localStorage.removeItem(ackKey)
  }
  const check = async () => {
    if (stopped || checking || !available()) return
    // Only the Jarvis window Usuário is actually seeing may claim the briefing.
    // Other open tabs must not consume the delivery behind the morning screen.
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return
    const profile=clientProfile()
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: profile.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
    if (clock < profile.deliverAt || clock >= profile.lateAudioCutoff) return
    checking = true
    try {
      await acknowledge()
      const response = await fetch(baseUrl + '/morning-briefing', { signal: AbortSignal.timeout(5000) })
      if (!response.ok) return
      const briefing: MorningBriefing = await response.json()
      if (!briefing.due || !briefing.text || briefing.delivered || briefing.inProgress || (briefing.retryAt && Date.parse(briefing.retryAt)>Date.now())) return
      if (!['ready', 'connection_pending', 'error'].includes(briefing.status)) return
      const query = '?date=' + encodeURIComponent(briefing.date)
      const claim = await fetch(baseUrl + '/morning-briefing/claim' + query, { method: 'POST', signal: AbortSignal.timeout(5000) })
      if (!claim.ok) return
      const {token}=await claim.json() as {token:string}
      const controller=new AbortController();active=controller
      const renew=setInterval(()=>{void fetch(baseUrl+'/morning-briefing/heartbeat'+query+'&token='+encodeURIComponent(token),{method:'POST',signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)controller.abort()}).catch(()=>controller.abort())},15000)
      let status='failed'
      try{
        if(!stopped){const result=await deliver(briefing,controller.signal);status=result==='cancelled'?'cancelled':result&&!controller.signal.aborted?'played':briefing.audioUrl?'failed':'text'}
      }finally{
        clearInterval(renew);active=null
        localStorage.setItem(ackKey,JSON.stringify({date:briefing.date,token,status}))
        await acknowledge()
      }
    } catch (error) { console.warn('[jarvis] briefing matinal:', error instanceof Error ? error.message : 'indisponível') }
    finally { checking = false }
  }
  const timer = setInterval(() => void check(), 1000)
  void check()
  return () => { stopped = true; active?.abort(); clearInterval(timer) }
}
