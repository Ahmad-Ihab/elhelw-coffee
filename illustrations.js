// Small inline vector illustrations are shared by the Android app and the offline preview.
(() => {
  const cream='#fff6df', gold='#edb65b', leaf='#85ad88', ink='#284e43', clay='#d68359', pale='#cae0c8';
  const shape=(d,fill=cream)=>'<path d="'+d+'" fill="'+fill+'"/>';
  const line=d=>shape(d,'none');
  const rect=(x,y,w,h,fill,r=3)=>'<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="'+r+'" fill="'+fill+'"/>';
  const circle=(x,y,r,fill)=>'<circle cx="'+x+'" cy="'+y+'" r="'+r+'" fill="'+fill+'"/>';
  const bean=(x,y,r)=>'<g transform="translate('+x+' '+y+') rotate('+r+')"><ellipse rx="5" ry="8" fill="'+clay+'"/>'+line('M1 -6Q-3 -2 0 2L0 6')+'</g>';
  const sack=shape('M26 27L22 15Q32 11 44 16L39 27Q51 40 50 52Q45 58 30 56Q15 58 16 49Q17 38 26 27Z',gold)+line('M25 26Q32 29 41 26M27 29L23 36')+bean(34,43,32);
  const sheet=rect(20,11,32,44,cream)+rect(27,9,17,7,leaf)+line('M27 26H45M27 33H42M27 40H37');
  const box=shape('M15 28L35 19L55 27L34 37Z',gold)+shape('M15 28L34 37V55L15 45Z',clay)+shape('M34 37L55 27V45L34 55Z',cream)+line('M25 23L46 32V39');
  const wheels=circle(24,48,6,ink)+circle(50,48,6,ink)+circle(24,48,2,pale)+circle(50,48,2,pale);
  const truck=rect(9,23,31,22,leaf)+shape('M40 29H50L60 38V46H40Z',gold)+shape('M44 32H49L55 38H44Z',pale)+wheels;
  const store=rect(14,29,44,24,cream)+shape('M13 28L19 16H53L60 28Q57 34 51 28Q45 34 40 28Q34 34 29 28Q23 34 18 28Q14 33 13 28Z',clay)+line('M23 17L20 26M32 17L30 27M42 17L42 27M49 17L52 26')+rect(21,35,12,18,leaf)+rect(39,35,12,10,gold);
  const factory=shape('M11 51V31L24 24V31L38 23V31H46L48 13H55L57 51Z',leaf)+rect(17,36,7,8,cream)+rect(29,36,7,8,cream)+rect(41,36,7,8,gold)+line('M49 10Q43 6 49 3');
  const cup=shape('M18 30H49L46 45Q33 58 21 45Z',cream)+shape('M49 32Q60 29 57 39Q55 44 48 43',gold)+line('M15 52H52M27 24Q20 20 28 14M36 24Q29 19 37 12');
  const wallet=rect(13,24,44,27,clay,5)+shape('M15 26L47 14L50 24Z',cream)+rect(41,32,18,12,gold)+circle(47,38,1,ink);
  const person=(x,y,fill)=>'<g transform="translate('+x+' '+y+')">'+circle(0,0,7,cream)+shape('M-13 22Q-13 8 0 9Q12 8 14 22Z',fill)+'</g>';
  const check=circle(47,43,12,leaf)+line('M40 43L45 48L54 37');
  const art={
    supplier:store, materials:sack, prices:shape('M11 34L32 13L49 14L55 30L32 54Z',gold)+circle(42,22,3,cream)+line('M22 36L35 24M27 42L39 30')+bean(52,48,38),
    buy:sheet+line('M43 46H58M51 38V53'), receive:box+line('M36 4V20M29 13L36 20L43 13'),
    quality:sheet+check, recipe:shape('M13 18Q24 12 35 19Q47 12 58 17V47Q47 42 35 50Q23 42 13 47Z',cream)+line('M35 20V49M19 25L29 27M19 32L29 34')+bean(46,29,30),
    factory, goods:box, delivery:truck, orders:sheet, payment:wallet, sales:store+bean(57,49,40),
    stock:shape('M10 29L35 13L61 29Z',leaf)+rect(15,29,40,23,cream)+rect(23,32,24,20,gold)+line('M24 38H46M24 44H46'),
    online:rect(11,13,48,36,ink)+rect(15,17,40,26,pale)+line('M35 50V55M24 55H47')+bean(35,29,35),
    team:person(25,25,leaf)+person(45,30,gold), finance:wallet,
    reports:rect(11,14,49,37,cream)+rect(20,35,7,10,leaf)+rect(31,29,7,16,gold)+rect(42,21,7,24,clay),
    setup:rect(13,18,45,33,pale)+line('M20 26H51M20 35H51M20 43H51')+circle(28,26,3,gold)+circle(44,35,3,clay)+circle(32,43,3,cream),
    chat:shape('M11 17H46V39H25L16 47V39H11Z',leaf)+shape('M37 29H60V47H54V53L46 47H37Z',cream)+line('M18 25H37M18 30H30'),
    alerts:shape('M18 44L23 35V29Q23 16 35 16Q48 16 48 29V35L54 44Z',gold)+circle(36,49,4,clay)+line('M35 15V11'),
    profile:person(35,23,leaf), coffee:cup, plan:sheet+bean(48,45,30), asset:factory+circle(52,46,7,gold), access:rect(20,29,32,22,leaf)+shape('M26 29V23Q26 9 37 11Q48 12 47 29Z',cream)+circle(36,38,3,gold),
    audit:sheet+circle(46,42,8,pale)+line('M52 49L58 55'), hr:person(26,25,leaf)+person(46,28,clay),
    roast:factory, return:box+line('M22 14H10L16 8M10 14L17 20'), calc:rect(20,9,33,46,leaf)+rect(25,15,23,10,cream)+rect(26,32,6,5,gold)+rect(38,32,6,5,gold)+rect(26,42,6,5,cream)+rect(38,42,6,5,cream)
  };
  window.elhelwArt=key=>'<svg class="scene-art" aria-hidden="true" focusable="false" viewBox="0 0 72 64" xmlns="http://www.w3.org/2000/svg"><ellipse cx="36" cy="55" rx="26" ry="3" fill="#adc4ae" opacity=".38"/><g stroke="'+ink+'" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">'+(art[key]||art.coffee)+'</g></svg>';
  // Keep each value paired with its column label when a record becomes a card on a phone.
  window.elhelwMobileRecords=root=>{
    for(const table of root.querySelectorAll(".table-wrap > table")){
      const labels=Array.from(table.tHead?.rows[0]?.cells||[],cell=>cell.textContent.trim());
      if(labels.length<3||table.tHead.rows.length!==1||table.querySelector("td[rowspan],th[rowspan]"))continue;
      table.classList.add("phone-records");
      for(const row of table.tBodies[0]?.rows||[]){
        if(row.cells.length!==labels.length)continue;
        Array.from(row.cells).forEach((cell,i)=>cell.dataset.heading=labels[i]);
      }
    }
  };
})();
