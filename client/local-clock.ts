/** Fixed local simulation steps: rendering at 10 Hz must not slow down the configured rules.
 * Limit only a single exceptional stall; hidden/portrait time is discarded explicitly by the caller.
 */
export class LocalClock {
  private accumulator=0;
  readonly fixed=1/60;
  reset(){this.accumulator=0;}
  advance(elapsed:number,step:(seconds:number)=>boolean|void){
    if(!Number.isFinite(elapsed)||elapsed<=0)return;
    this.accumulator+=Math.min(elapsed,.25);
    while(this.accumulator+1e-9>=this.fixed){
      this.accumulator-=this.fixed;
      if(step(this.fixed)===false){this.reset();break;}
    }
  }
}
