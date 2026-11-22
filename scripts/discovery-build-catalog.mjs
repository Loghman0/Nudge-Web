import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {starterEditionTwo} from './lib/discovery-starter-edition-two.mjs';
import {editionThreeQuestions} from './lib/discovery-edition-three.mjs';
import {playSessionV3} from './lib/discovery-play-v3.mjs';
import {choice,scale,text,rank,signal,criterion,priorityChoice,legacyUuid} from './lib/discovery-question-kit.mjs';

const root=new URL('../',import.meta.url);
// Owner-approved 2026-11-20 (00023, 00025). A bundle carrying these pools may
// only be installed on a real device after the hosted database has the rows
// and Web is deployed; verify with a disposable session first.
export const appliedMigrations={playSessionV3:true,editionThree:true};

export const decisionPriorityQuestions=[
 priorityChoice('food-weeknight-tradeoff','food','weeknight-meal','You’re making dinner on a busy night. What would make one meal win over another?','for a busy-night dinner',[
  ['It comes together fast','speed','Quick preparation'],['There’s almost nothing to wash','cleanup','Easy cleanup'],['I already have what I need','ingredients','Ingredients already on hand'],
 ]),
 priorityChoice('food-lunch-tradeoff','food','lunch-out','You’re choosing lunch between errands. What would tip the choice?','for lunch between errands',[
  ['I can get it without waiting','wait','A short wait'],['I know it will fill me up','filling','A filling portion'],['It gives me a chance to try something new','novelty','Something new to try'],
 ]),
 priorityChoice('study-short-session','learning','short-study-session','You have 20 minutes before your next class. Which would make that time feel well spent?','for a short study session',[
  ['Practice one thing from memory','practice','Recall practice'],['Work through one example','example','Worked examples'],['Clear up one question I’m stuck on','question','Help with one sticking point'],
 ],['study','learning']),
 priorityChoice('study-space-tradeoff','learning','study-space','If you could study in any of these settings, what would matter most?','for a place to study',[
  ['Somewhere I can count on quiet','quiet','Quiet surroundings'],['Somewhere I can get to quickly','access','Easy to get to'],['Somewhere a friend can join','company','Room to study with a friend'],
 ],['study','learning']),
 priorityChoice('rest-break-tradeoff','rest','short-break','You have a short break and nothing you need to get done. What would make it feel like a break?','for a short break',[
  ['A few minutes with no input','quiet','Low stimulation'],['A change of scenery','scenery','A change of scenery'],['A little time with someone I like','company','Easy company'],
 ]),
 priorityChoice('rest-evening-tradeoff','rest','evening-plan','After a full day, what would make an evening plan sound easier to say yes to?','for an evening after a full day',[
  ['I can stay close to home','nearby','Close to home'],['I can leave whenever I like','flexible','Freedom to leave early'],['Someone else takes care of the details','effort','Little planning effort'],
 ]),
 priorityChoice('money-small-purchase-tradeoff','money','small-purchase','Two everyday items would both do the job. What usually tips a small purchase for you?','for a small everyday purchase',[
  ['Pay less today','cost','Lower upfront cost'],['Get something that will last longer','durable','Expected durability'],['Be able to return it easily','return','An easy return'],
 ]),
 priorityChoice('money-recurring-service-tradeoff','money','recurring-service','You’re choosing between two low-cost monthly services. What do you check first?','for a monthly service',[
  ['What I’ll actually pay each month','cost','Total monthly cost'],['How easy it is to cancel','cancel','Easy cancellation'],['Whether I’ll use it most weeks','use','Expected frequency of use'],
 ]),
];

/** Explicit editorial seeds are not represented as human/clinical validation. */
export const starterQuestions=[
 choice('rest-break','rest','breaks','A busy day gives you 20 minutes back. What sounds best?',['Quiet music','A chat with someone familiar','A tiny hands-on project','A little fresh air'],{preview:true,signals:[signal('a','rest.break.setting','quiet_music','You chose quiet music for a break after a busy day.','a short break after a busy day'),signal('c','rest.break.setting','hands_on','You chose a tiny hands-on project for a break.','a short break after a busy day')]}),
 scale('rest-evening','rest','stimulation','For a relaxed evening, where is your sweet spot?','Very little going on','A little buzz around me'),
 choice('time-free-day','time','planning','Tomorrow is unexpectedly free. Pick your kind of plan.',['One thing to look forward to, rest open','A few things lined up','Decide when I wake up'],{preview:true,signals:[signal('a','time.free_day.plan','one_anchor','You chose one planned activity with room around it.','an unexpectedly free day',criterion('Flexibility','travel','lifestyle','hobbies')),signal('b','time.free_day.plan','several_plans','You chose a few things lined up for a free day.','an unexpectedly free day'),signal('c','time.free_day.plan','spontaneous','You chose to decide when the free day starts.','an unexpectedly free day',criterion('Flexibility','travel','lifestyle','hobbies'))]}),
 rank('time-afternoon','time','priorities','What would make a free afternoon feel well used? Rank up to two.',['Rest','Finish one lingering task','Spend time with someone']),
 choice('values-upgrade','values','tradeoffs','A service you use offers one free upgrade. Which would you take?',['Less waiting','More choice','More dependable results','Easier help when something goes wrong'],{signals:[signal('a','service.priority','less_waiting','You chose less waiting as a service upgrade.','a service upgrade',criterion('Waiting time','shopping','travel')),signal('c','service.priority','dependability','You chose more dependable results as a service upgrade.','a service upgrade',criterion('Dependability','shopping','work'))]}),
 text('values-friction','values','friction','What tiny inconvenience are you surprisingly unwilling to put up with?'),
 choice('relationships-support','relationships','support','A friend says, “Today was a lot.” What would you offer first?',['Listen','A practical hand','A distraction','Ask what would help']),
 scale('relationships-notice','relationships','scheduling','For a casual catch-up, how much advance notice feels good?','Same-day is fine','A few days ahead'),
 choice('learning-puzzle','learning','starting','You find a puzzle box with no obvious opening. Your first move?',['Try one small thing','Look for an example','Ask for a hint','Study it for a moment'],{preview:true,signals:[signal('a','learning.starting.method','small_experiment','You chose a small first attempt with the unfamiliar puzzle.','an unfamiliar low-stakes puzzle',criterion('Chance to try a small example','learning','hobbies')),signal('b','learning.starting.method','example','You chose to look for an example before opening the puzzle.','an unfamiliar low-stakes puzzle',criterion('Worked examples','learning')),signal('c','learning.starting.method','hint','You chose to ask for a hint with an unfamiliar puzzle.','an unfamiliar low-stakes puzzle'),signal('d','learning.starting.method','study','You chose to study the puzzle before trying it.','an unfamiliar low-stakes puzzle')]}),
 rank('work-focus','work','focus','For an hour of work or study, rank the two things that help most.',['Quiet','A clear brief','Someone to ask','Control over the pace'],{signals:[signal('a','work.focus.support','quiet','You ranked quiet among your first priorities for focused work.','focused work or study',criterion('Quiet surroundings','work','career','learning')),signal('b','work.focus.support','clear_brief','You ranked a clear brief among your first priorities for focused work.','focused work or study',criterion('Clear expectations','work','career','learning')),signal('d','work.focus.support','pace','You ranked control over the pace among your first priorities.','focused work or study',criterion('Control over the pace','work','career','learning'))]}),
 text('work-before-group','work','collaboration','What makes a group task feel easier before anyone even starts?'),
 choice('money-broken-item','money','purchasing','An everyday item breaks. If each option is practical, which would you explore first?',['Repair','Borrow','Buy used','Buy new'],{signals:[signal('a','shopping.replacement.approach','repair','You chose to explore repair first when an everyday item breaks.','replacing a broken everyday item',criterion('Repairability','shopping')),signal('c','shopping.replacement.approach','used','You chose to explore buying used first.','replacing a broken everyday item',criterion('Availability used','shopping'))]}),
 choice('food-snack','food','novelty','A café offers two equally appealing snacks. Which gets your vote?',['My favorite, made really well','A combination I have never tried'],{preview:true,allowedResponses:['both','depends','neither','skip'],signals:[signal('a','food.snack.familiarity','familiar','You chose a familiar favorite for the café snack.','two equally appealing café snacks'),signal('b','food.snack.familiarity','new','You chose a new combination for the café snack.','two equally appealing café snacks')]}),
 scale('food-texture','food','texture','Pick the texture you are in the mood for.','Smooth and soft','Crisp and crunchy'),
 choice('culture-spare-hour','culture','exploration','You have a spare hour somewhere unfamiliar. What would you look for?',['Local music','A food market','A small museum','Ordinary streets and shops']),
 text('culture-tradition','culture','traditions','Is there a small tradition you enjoy keeping—or inventing? “None” is fine.',{sensitivity:'optional'}),
 choice('play-humor','play','humor','Which joke is more likely to get you?',['A painfully good pun','A completely absurd situation'],{preview:true,purpose:'playful',allowedResponses:['both','depends','neither','skip']}),
 choice('play-group-game','play','cooperation','Your group is choosing a game. Which promise sounds better tonight?',['We solve something together','We try to outsmart each other','We make something ridiculous']),
 choice('creativity-postcard','creativity','starting','You are making a postcard for fun. Where do you start?',['A messy sketch','A color I like','A reference to borrow from','A message to build around'],{preview:true,signals:[signal('a','creativity.starting.method','rough_attempt','You chose a messy sketch to begin the postcard.','starting a playful postcard',criterion('Room for a rough first attempt','hobbies','learning')),signal('b','creativity.starting.method','color','You chose a color as the starting point for the postcard.','starting a playful postcard'),signal('c','creativity.starting.method','reference','You chose a reference as the starting point for the postcard.','starting a playful postcard'),signal('d','creativity.starting.method','message','You chose a message as the starting point for the postcard.','starting a playful postcard')]}),
 text('creativity-box','creativity','making','Give an ordinary cardboard box a second career. What does it become?',{purpose:'playful'}),
 text('childhood-interest','childhood','interests','What ordinary thing did you enjoy as a child that still sounds fun?',{sensitivity:'optional',depth:1}),
 choice('childhood-revisit','childhood','change','If you revisited an old hobby, what would appeal most?',['The familiar feeling','Seeing how I have changed','Trying it a new way','I would rather choose something new'],{sensitivity:'optional',depth:1}),
 choice('uncertainty-first-step','uncertainty','support','Trying an unfamiliar activity just for fun: what would make the first step easier?',['A tiny practice run','A familiar person','Watching once','Clear instructions'],{sensitivity:'optional',signals:[signal('a','learning.unfamiliar.support','practice','You chose a tiny practice run to begin an unfamiliar activity.','trying an unfamiliar activity for fun',criterion('A low-stakes trial','hobbies','learning')),signal('d','learning.unfamiliar.support','instructions','You chose clear instructions to begin an unfamiliar activity.','trying an unfamiliar activity for fun',criterion('Clear instructions','hobbies','learning'))]}),
 scale('uncertainty-day-out','uncertainty','surprise','For a low-stakes day out, how much surprise is welcome?','Tell me the plan','Leave plenty to discover',{sensitivity:'optional'}),
 choice('community-quiet-seat','community','fairness','Three friends want the one quiet seat on a trip. What seems like the best starting rule?',['Take turns','Draw lots','Ask who needs it most','Talk it through']),
 choice('community-role','community','contribution','At a friendly event, which small role would you enjoy?',['Welcome people','Set things up','Show someone how something works','Help quietly in the background']),
 rank('places-afternoon','places','comfort','For a place to spend an afternoon, rank your top two.',['Quiet','Easy to reach','Interesting things nearby','Comfortable seating'],{signals:[signal('a','places.afternoon.priority','quiet','You ranked quiet among your first priorities for an afternoon place.','choosing an afternoon place',criterion('Quiet surroundings','travel','lifestyle')),signal('b','places.afternoon.priority','access','You ranked easy access among your first priorities for an afternoon place.','choosing an afternoon place',criterion('Ease of getting there','travel','lifestyle')),signal('d','places.afternoon.priority','seating','You ranked comfortable seating among your first priorities.','choosing an afternoon place',criterion('Comfortable seating','travel','lifestyle'))]}),
 choice('movement-change','movement','comfort','For a short change of pace, what sounds comfortable today?',['A gentle stretch','A short walk if practical','Moving to some music','Staying still and resting']),
 choice('digital-quiet-minutes','digital','attention','You get 40 notification-free minutes. How would you like to keep them?',['Silence everything','Let chosen people through','Check once halfway','I do not need that today']),
 text('future-room','future','goals','What would you like to make a little more room for next month?'),
 choice('future-small-progress','future','progress','A personal project is moving slowly. What would count as a good next step?',['Try a tiny version','Set aside a regular slot','Ask one useful question','Decide whether I still want it']),
 choice('future-experiment','future','experiments','You have an idea for a new hobby. What would you try before making a bigger commitment?',['Borrow the equipment','Join one beginner session','Watch someone do it','Set up a short experiment at home']),
];
const topicDomain={food:'food',movies:'culture',music:'culture',travel:'places',shopping:'money',health:'movement',career:'work',relationships:'relationships',finance:'money',hobbies:'play',home:'places',learning:'learning',digital:'digital',values:'values',time:'time',creativity:'creativity',sustainability:'community',wellbeing:'rest',gaming:'play',outdoors:'places',reading:'culture',making:'creativity',community:'community',sports:'movement'};
const uuid=legacyUuid;
export function convertExistingTree(content,{expansion=false}={}) {
 const lines=content.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
 const questions=[];
 if(lines.length%8)throw new Error('Existing question tree must contain complete seven-question groups.');
 for(let i=0;i<lines.length;i+=8){
  const [topic]=lines[i].split('|');if(!topicDomain[topic])throw new Error(`Unknown existing topic ${topic}`);
  const paths=['root','a','b','aa','ab','ba','bb'];
  for(let j=0;j<7;j++){
   const [prompt,a,b]=lines[i+j+1].split('|');if(!prompt||!a||!b||a===b)throw new Error('Invalid existing question.');
   questions.push(choice(`existing-${topic}-${paths[j]}`,topicDomain[topic],topic,prompt,[a,b],{
    familyId:`existing-${topic}-${paths[j]}`,source:'existing',depth:j===0?0:j<3?1:2,
    review:{type:'existing_catalog',version:1},tags:['existing_catalog',`topic:${topic}`],
    legacyQuestionId:uuid(`${topic}:${paths[j]}`,expansion?'nudge-discover-expansion-v1':'nudge-discover-v1'),
    allowedResponses:['both','depends','neither','skip'],
    // Legacy branch descriptions are not independent global personality claims.
    signals:[signal('a',`discovery.${topic}.${paths[j]}`,'a',`For “${prompt}”, you chose “${a}”.`,prompt),signal('b',`discovery.${topic}.${paths[j]}`,'b',`For “${prompt}”, you chose “${b}”.`,prompt)],
   }));
  }
 }
 return questions;
}
export async function buildInitialCatalog(){
 const base=convertExistingTree(await readFile(new URL('data/discover-trees.txt',root),'utf8'));
 const extra=convertExistingTree(await readFile(new URL('data/discover-expansion.txt',root),'utf8'),{expansion:true});
 const catalog=[...starterQuestions,...base,...extra];
 if(catalog.length!==200||new Set(catalog.map(question=>question.id)).size!==catalog.length)throw new Error('Expected 200 distinct catalog IDs.');
 return catalog;
}
export async function buildCatalog(){
 const editions=[...starterEditionTwo,...(appliedMigrations.playSessionV3?[playSessionV3]:[])];
 const updates=new Map(editions.map(q=>[q.id,q]));
 const catalog=[...(await buildInitialCatalog()).map(q=>updates.get(q.id)??q),...decisionPriorityQuestions,...(appliedMigrations.editionThree?editionThreeQuestions:[])];
 if(new Set(catalog.map(q=>q.id)).size!==catalog.length)throw new Error('Discovery catalog has duplicate IDs.');
 return catalog;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const catalog=await buildCatalog();
 const history=[...(await buildInitialCatalog()).filter(q=>starterEditionTwo.some(updated=>updated.id===q.id)),...(appliedMigrations.playSessionV3?starterEditionTwo.filter(q=>q.id===playSessionV3.id):[])];
 // The native onboarding pool: every published choice question a signed-out
 // device may ask and claim (the native quiz renders choices only). It holds
 // the current edition of the preview questions and their earlier editions,
 // so each install can be given a different six.
 const onboarding=[...catalog,...history].filter(q=>q.preview&&q.status==='published'&&q.format==='choice');
 // The web guest quiz stays the six starter families: edition numbers are
 // global there, so first editions of new families must not join edition 1.
 const previewFamilies=new Set(starterEditionTwo.map(q=>q.id));
 const preview=catalog.filter(q=>q.preview&&q.status==='published'&&previewFamilies.has(q.id));
 for(const [name,items] of [['discovery-catalog',catalog],['discovery-preview',preview],['discovery-history',history],['discovery-onboarding',onboarding]]){
  const output=JSON.stringify(items,null,2)+'\n',target=new URL(`data/${name}.json`,root);
  if(process.argv.includes('--check')){if(await readFile(target,'utf8')!==output)throw new Error('Discovery catalog is stale. Run scripts/discovery-build-catalog.mjs.');}
  else await writeFile(target,output);
 }
 console.log(`Discovery catalog and lightweight preview are current: ${catalog.length} items, ${onboarding.length} claimable onboarding questions.`);
}
