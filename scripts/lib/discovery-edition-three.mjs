import {priorityChoice,scale} from './discovery-question-kit.mjs';

// Edition three: two deeper trade-offs per existing domain plus three new
// domains (home, style, nature). Additive families at version 1; requires
// migration 00025 before any client may offer them.
export const editionThreeQuestions=[
 priorityChoice('rest-recovery-tradeoff','rest','recovery','After a draining week, what would make a recovery day feel right?','for a recovery day',[
  ['Nothing scheduled at all','empty','An empty schedule'],['One gentle plan I can cancel','light','A cancellable plan'],['Slow time with people I like','company','Easy company'],
 ],['rest','wellbeing']),
 priorityChoice('rest-solitude-tradeoff','rest','solitude','You have a free evening alone. What would make it feel like yours?','for a free evening alone',[
  ['No messages expected of me','unreachable','Being unreachable'],['A small ritual I enjoy','ritual','A personal ritual'],['Room to change my mind later','flexible','Room to change plans'],
 ]),
 priorityChoice('time-morning-tradeoff','time','pace','What would make a morning feel well started?','for starting a morning',[
  ['A slow start with no rush','slow','An unhurried start'],['One clear first task','clear','One clear first task'],['A routine I already know','familiar','A familiar routine'],
 ]),
 priorityChoice('time-transitions-tradeoff','time','transitions','Between two commitments, what would make the gap feel useful?','for the gap between commitments',[
  ['Enough buffer to arrive calm','buffer','Arrival buffer'],['A chance to switch tasks properly','switch','A proper task switch'],['A few minutes of nothing','pause','A few empty minutes'],
 ]),
 priorityChoice('values-quality-tradeoff','values','quality','Two options both work. What makes one feel like the better choice?','for choosing between working options',[
  ['It is made to last','durable','Durability'],['It respects my time','time','Respect for my time'],['It matches what I care about','aligned','Alignment with my values'],
 ]),
 priorityChoice('values-autonomy-tradeoff','values','autonomy','What would make a plan feel like yours?','for a plan to feel like yours',[
  ['I can change it without asking','changeable','Freedom to change it'],['I chose every part myself','chosen','Having chosen every part'],['It leaves room for my own way','flexible','Room for my own way'],
 ]),
 priorityChoice('relationships-boundaries-tradeoff','relationships','boundaries','A friend asks for help on a busy day. What would make saying yes feel okay?','for helping a friend on a busy day',[
  ['A clear end time','bounded','A clear end time'],['Help that fits my energy','fitting','Help that fits my energy'],['Being able to say no later','reversible','Being able to stop later'],
 ]),
 priorityChoice('relationships-communication-tradeoff','relationships','communication','What makes a check-in message feel good to receive?','for a check-in message',[
  ['Short and no reply expected','lowpressure','No reply expected'],['A real question about me','curious','A real question about me'],['Something shared, not asked','sharing','Something shared, not asked'],
 ]),
 priorityChoice('work-feedback-tradeoff','work','feedback','What would make feedback on your work feel useful?','for feedback on your work',[
  ['Specific next steps','actionable','Specific next steps'],['Honest about what missed','honest','Honesty about misses'],['Private and calm','private','A private, calm setting'],
 ],['work','career']),
 priorityChoice('work-ambition-tradeoff','work','ambition','A bigger opportunity appears. What would tip you toward it?','for taking a bigger opportunity',[
  ['Room to grow into it','growth','Room to grow'],['A pace I can sustain','sustainable','A sustainable pace'],['People I trust around it','company','Trusted people around it'],
 ],['work','career']),
 priorityChoice('learning-explanations-tradeoff','learning','explanations','What makes an explanation finally click for you?','for an explanation to click',[
  ['A concrete example first','example','A concrete example first'],['The why behind the steps','why','The why behind the steps'],['Trying it myself with hints','practice','Trying it with hints'],
 ]),
 priorityChoice('learning-challenge-tradeoff','learning','challenge','What keeps a practice session worth continuing?','for continuing a practice session',[
  ['A challenge just above my level','stretch','A challenge just above my level'],['Visible small progress','progress','Visible small progress'],['Freedom to repeat basics','repeat','Freedom to repeat basics'],
 ]),
 priorityChoice('money-borrowing-tradeoff','money','borrowing','You need something for one week. What decides borrow versus buy?','for borrowing versus buying',[
  ['Total cost for the week','cost','Total cost for the week'],['How easy returning is','return','Ease of returning'],['Whether I will need it again','reuse','Whether I will need it again'],
 ],['shopping','finance']),
 priorityChoice('money-priorities-tradeoff','money','priorities','What makes a purchase feel worth it a month later?','for a purchase a month later',[
  ['I still use it most weeks','use','Regular use'],['It removed a daily annoyance','relief','A removed daily annoyance'],['It held up without repairs','durable','Holding up without repairs'],
 ],['shopping','finance']),
 priorityChoice('food-preparation-tradeoff','food','preparation','What would make cooking at home win over ordering?','for cooking at home over ordering',[
  ['A recipe I can trust','trust','A trusted recipe'],['Ingredients already here','ingredients','Ingredients already here'],['Cleanup I can face','cleanup','Cleanup I can face'],
 ]),
 priorityChoice('food-flavor-tradeoff','food','flavor','Choosing a dish you have never tried. What tips it?','for choosing an unfamiliar dish',[
  ['Flavors I recognize','familiar','Recognizable flavors'],['One surprise element','surprise','One surprise element'],['Reviews from people like me','social','Reviews from people like me'],
 ]),
 priorityChoice('culture-stories-tradeoff','culture','stories','What makes a story stay with you?','for a story to stay with you',[
  ['Characters I recognize','characters','Characters I recognize'],['A world I can picture','world','A world I can picture'],['An ending that surprises','ending','A surprising ending'],
 ],['reading','movies']),
 priorityChoice('culture-music-tradeoff','culture','music','What makes a playlist feel like yours?','for a playlist to feel like yours',[
  ['Songs tied to memories','memory','Songs tied to memories'],['A steady mood throughout','mood','A steady mood'],['Room for new finds','discovery','Room for new finds'],
 ],['music']),
 priorityChoice('play-competition-tradeoff','play','competition','What makes a competitive game fun for you?','for a competitive game',[
  ['Close matches, either result','close','Close matches'],['Clear rules everyone knows','fair','Clear, shared rules'],['Playing people I like','company','Playing people I like'],
 ],['gaming','hobbies']),
 priorityChoice('play-game-length-tradeoff','play','games','How long should a game session run to feel good?','for a game session',[
  ['Short rounds I can stop anytime','rounds','Short, stoppable rounds'],['One longer session to settle in','long','One longer session'],['Whatever the group is doing','group','Whatever the group does'],
 ],['gaming','hobbies']),
 priorityChoice('creativity-experimenting-tradeoff','creativity','experimenting','What makes trying a new craft feel safe to start?','for starting a new craft',[
  ['Cheap materials to waste','cheap','Cheap materials to waste'],['A small first project','small','A small first project'],['No one watching yet','private','No one watching yet'],
 ],['making','hobbies']),
 priorityChoice('creativity-finishing-tradeoff','creativity','finishing','What helps you finish a personal project?','for finishing a personal project',[
  ['A deadline I chose','deadline','A self-chosen deadline'],['Sharing it with one person','share','Sharing it with one person'],['Calling a version done','version','Calling a version done'],
 ],['making']),
 priorityChoice('childhood-memory-tradeoff','childhood','ordinary_memories','What makes an old memory worth revisiting?','for revisiting an old memory',[
  ['The people in it','people','The people in it'],['How simple things felt','simple','How simple things felt'],['Seeing how far I came','growth','Seeing how far I came'],
 ],undefined,{sensitivity:'optional',depth:1}),
 priorityChoice('childhood-old-self-tradeoff','childhood','change','Meeting your younger self, what would you want them to know?','for a message to your younger self',[
  ['Some things get easier','easier','Some things get easier'],['Keep the odd interests','interests','Keep the odd interests'],['Rest is allowed','rest','Rest is allowed'],
 ],undefined,{sensitivity:'optional',depth:1}),
 priorityChoice('uncertainty-small-steps-tradeoff','uncertainty','small_steps','What makes a first step into something new feel possible?','for a first step into something new',[
  ['A way to back out','exit','A way to back out'],['One small visible win','win','One small visible win'],['Someone beside me','company','Someone beside me'],
 ],undefined,{sensitivity:'optional'}),
 scale('uncertainty-plan-scale','uncertainty','surprise','For a weekend plan, how much should be decided ahead?','Everything settled','Leave it open',{sensitivity:'optional',preview:true}),
 priorityChoice('community-reciprocity-tradeoff','community','reciprocity','What makes helping a neighbor feel good?','for helping a neighbor',[
  ['They would do the same','mutual','Mutual willingness'],['No scorekeeping needed','noledger','No scorekeeping'],['It costs me little','cheap','A small cost to me'],
 ]),
 priorityChoice('community-sustainability-tradeoff','community','sustainability','What makes a greener choice easy to keep?','for keeping a greener choice',[
  ['It saves money too','saves','Saving money too'],['No extra effort','effortless','No extra effort'],['It is the default option','default','Being the default'],
 ],['sustainability']),
 priorityChoice('places-travel-tradeoff','places','travel','What makes a trip feel like a break?','for a trip to feel like a break',[
  ['Few planned stops','few','Few planned stops'],['One place I know well','familiar','One familiar place'],['Room to wander','wander','Room to wander'],
 ],['travel']),
 priorityChoice('places-outdoors-tradeoff','places','outdoors','What makes time outside worth it?','for time outside',[
  ['Fresh air and quiet','air','Fresh air and quiet'],['Something to look at','views','Something to look at'],['Easy to get back from','access','Easy to get back from'],
 ],['outdoors','travel']),
 priorityChoice('movement-enjoyment-tradeoff','movement','enjoyment','What makes movement feel like play, not chores?','for movement to feel like play',[
  ['Music or a game attached','play','Music or a game attached'],['No tracking or targets','notracked','No tracking or targets'],['A friend alongside','company','A friend alongside'],
 ],['sports','wellbeing']),
 priorityChoice('movement-rest-tradeoff','movement','rest','After activity, what makes recovery feel complete?','for recovery after activity',[
  ['Real rest, no guilt','rest','Real rest without guilt'],['A slow stretch','stretch','A slow stretch'],['Food and company','refuel','Food and company'],
 ],['wellbeing','rest']),
 priorityChoice('digital-channels-tradeoff','digital','channels','What makes a message channel feel manageable?','for a message channel',[
  ['One place for everything','single','One place for everything'],['Only people I chose','chosen','Only chosen people'],['Quiet by default','quiet','Quiet by default'],
 ]),
 priorityChoice('digital-information-tradeoff','digital','information','What makes news or feeds feel worth your time?','for news or feeds',[
  ['A fixed short window','window','A fixed short window'],['Sources I trust','trust','Trusted sources'],['No autoplay pull','nopull','No autoplay pull'],
 ]),
 priorityChoice('future-goal-size-tradeoff','future','goals','What makes a goal feel possible this month?','for a goal this month',[
  ['A tiny first version','tiny','A tiny first version'],['A regular small slot','slot','A regular small slot'],['A clear enough finish line','finish','A clear finish line'],
 ]),
 priorityChoice('future-progress-signal-tradeoff','future','progress','What tells you a project is moving?','for seeing a project move',[
  ['Something shipped, however small','shipped','Something shipped'],['A skill I can repeat','skill','A repeatable skill'],['Fewer stuck moments','unstuck','Fewer stuck moments'],
 ]),
 priorityChoice('home-space-tradeoff','home','space','What would make your room feel easier to be in?','for your room',[
  ['Clear surfaces','clear','Clear surfaces'],['Everything has a place','places','A place for everything'],['Corners for different moods','zones','Corners for different moods'],
 ],undefined,{preview:true}),
 priorityChoice('home-belongings-tradeoff','home','belongings','What decides whether you keep an object?','for keeping an object',[
  ['I use it most weeks','use','Regular use'],['It carries a memory','memory','A carried memory'],['It earns its space','space','Earning its space'],
 ],['shopping']),
 scale('home-atmosphere-scale','home','atmosphere','For your space at night, where is your sweet spot?','Dim and quiet','Lived-in and warm'),
 priorityChoice('style-clothing-tradeoff','style','clothing','What makes an outfit feel right?','for an outfit',[
  ['Comfort I forget about','comfort','Comfort I forget about'],['It looks like me','identity','Looking like me'],['Fits the occasion','occasion','Fitting the occasion'],
 ],undefined,{preview:true}),
 priorityChoice('style-expression-tradeoff','style','expression','What makes trying a new look feel safe?','for trying a new look',[
  ['One small change at a time','small','One small change'],['Something reversible','reversible','Something reversible'],['People who get it around','company','People who get it'],
 ]),
 scale('style-comfort-scale','style','comfort','For everyday wear, where is your sweet spot?','Blend in comfortably','Stand out a little'),
 priorityChoice('nature-outdoors-tradeoff','nature','outdoors','What makes a walk outside feel worth it?','for a walk outside',[
  ['Quiet and green','quiet','Quiet and green'],['Something new to notice','novel','Something new to notice'],['Good company','company','Good company'],
 ],['outdoors'],{preview:true}),
 priorityChoice('nature-seasons-tradeoff','nature','seasons','What do you plan around most?','for planning time outside',[
  ['Daylight hours','light','Daylight hours'],['Weather I can trust','weather','Trustworthy weather'],['Seasons I enjoy','season','Seasons I enjoy'],
 ],['outdoors']),
 scale('nature-weather-scale','nature','weather','For time outside, how much weather prep feels right?','Go as-is','Plan for every change'),
];