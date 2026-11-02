'use strict';
// Сумма прописью: 125 400,50 → «Сто двадцать пять тысяч четыреста рублей 50 копеек»
const ONES=[['','один','два','три','четыре','пять','шесть','семь','восемь','девять'],['','одна','две','три','четыре','пять','шесть','семь','восемь','девять']];
const TEENS=['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
const TENS=['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
const HUNDREDS=['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
const plural=(n,[one,few,many])=>{n=Math.abs(n)%100;const d=n%10;if(n>10&&n<20)return many;if(d>1&&d<5)return few;if(d===1)return one;return many};
const SCALES=[[['рубль','рубля','рублей'],0],[['тысяча','тысячи','тысяч'],1],[['миллион','миллиона','миллионов'],0],[['миллиард','миллиарда','миллиардов'],0]];
function triad(n,fem){const out=[];out.push(HUNDREDS[Math.floor(n/100)]);const r=n%100;if(r>=10&&r<20)out.push(TEENS[r-10]);else{out.push(TENS[Math.floor(r/10)]);out.push(ONES[fem][r%10])}return out.filter(Boolean)}
function rublesInWords(amount){
 const v=Math.round((Math.abs(Number(amount)||0)+Number.EPSILON)*100),rub=Math.floor(v/100),kop=v%100;
 const parts=[];let n=rub,i=0;
 if(n===0)parts.unshift('ноль рублей');
 while(n>0&&i<SCALES.length){const t=n%1000;const [forms,fem]=SCALES[i];if(t||i===0){const words=triad(t,fem);if(i===0)parts.unshift([...words,plural(t,forms)].join(' '));else if(t)parts.unshift([...words,plural(t,forms)].join(' '))}n=Math.floor(n/1000);i++}
 let s=parts.join(' ').replace(/\s+/g,' ').trim();
 s=s.charAt(0).toUpperCase()+s.slice(1);
 return `${s} ${String(kop).padStart(2,'0')} ${plural(kop,['копейка','копейки','копеек'])}`;
}
const MONTHS=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function dateText(iso){const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||''));if(!m)return '';return `«${m[3]}» ${MONTHS[Number(m[2])-1]} ${m[1]} г.`}
function dateRu(iso){const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||''));return m?`${m[3]}.${m[2]}.${m[1]}`:''}
function initials(full){const p=String(full||'').trim().split(/\s+/);if(p.length<2)return p[0]||'';return p[0]+' '+p.slice(1,3).map(x=>x[0].toUpperCase()+'.').join('')}
module.exports={rublesInWords,dateText,dateRu,initials};
