import { quoteUsdToNgn } from './quote.mjs';
const buttons = [...document.querySelectorAll('[data-view]')];
const panels = [...document.querySelectorAll('[data-panel]')];
const labels = { overview: 'Overview', accounts: 'Accounts', exchange: 'Exchange', withdrawals: 'Withdrawals', operations: 'Operations' };
function show(view) {
 if (!Object.hasOwn(labels,view)) return;
 buttons.forEach(b=>{ b.setAttribute('aria-current',b.dataset.view===view ? 'page' : 'false'); b.classList.toggle('active',b.dataset.view===view); });
 panels.forEach(p=>{p.hidden=p.dataset.panel!==view;});
 document.querySelector('#page-title').textContent=labels[view];
 document.title=labels[view]+' · Evolve Bank Sandbox';
 window.location.hash=view;
}
buttons.forEach(b=>b.addEventListener('click',()=>show(b.dataset.view)));
show(Object.hasOwn(labels,location.hash.slice(1)) ? location.hash.slice(1) : 'overview');
window.addEventListener('hashchange',()=>{const v=location.hash.slice(1); if(Object.hasOwn(labels,v))show(v);});
const form=document.querySelector('#demo-quote');
const moneyUSD = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2});
const moneyNGN = new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',minimumFractionDigits:2});
form.addEventListener('submit',event=>{
 event.preventDefault();
 const output=document.querySelector('#quote-result');
 const explanation=document.querySelector('#quote-details');
 try {
   const q=quoteUsdToNgn(document.querySelector('#send-amount').value.trim());
   output.textContent=moneyNGN.format(Number(q.amountNgnKobo)/100);
   explanation.textContent='Fictitious rate: 1 USD = ₦1,000.00 · Example fee: '+moneyUSD.format(Number(q.feeUsdCents)/100)+' · No funds move.';
 } catch(err) { output.textContent='—'; explanation.textContent=err instanceof Error ? err.message : 'Invalid amount'; }
});
