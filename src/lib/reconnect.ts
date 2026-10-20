const reconnectNotice = 'Conexão perdida — reconectando.'
const obsoleteNotice = 'Conexão restabelecida. A conversa anterior não foi mantida.'

/** Recovery is not evidence of lost history. Never clear an unrelated failure. */
export function connectionError(state: 'open' | 'lost' | 'reconnected', current: string | null): string | null {
  if (state === 'lost') return current || reconnectNotice
  return current === reconnectNotice || current === obsoleteNotice ? null : current
}

/** One retry chain, with a bounded delay but no permanent abandonment. */
export function createReconnect(connect: () => Promise<unknown>, connected: () => boolean,
  timers = {set:(fn:()=>void,ms:number)=>setTimeout(fn,ms),clear:(id:ReturnType<typeof setTimeout>)=>clearTimeout(id)}) {
  const delays=[500,1000,2000,4000,8000,15000,30000]
  let timer:ReturnType<typeof setTimeout>|undefined, attempt=0, stopped=false
  const reset=()=>{if(timer!==undefined)timers.clear(timer);timer=undefined;attempt=0}
  const schedule=()=>{
    if(stopped || connected() || timer!==undefined)return
    timer=timers.set(()=>{timer=undefined;void connect().catch(()=>{}).finally(()=>{if(connected())reset();else schedule()})},delays[Math.min(attempt++,delays.length-1)])
  }
  return {schedule,reset,wake:()=>{stopped=false;reset();schedule()},stop:()=>{stopped=true;reset()}}
}
