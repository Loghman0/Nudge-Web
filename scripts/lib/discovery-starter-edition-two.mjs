// Authored, research-informed prompts. Not a validated psychological instrument.
// Statements reflect only the reported answer, never a hidden personality score.
const criterion=(label,...decisionDomains)=>({label,decisionDomains});
const question=(id,domain,subdomain,prompt,scope,attribute,options)=>({
 id,version:2,familyId:id,domain,subdomain,prompt,format:'choice',
 choices:options.map(([label],i)=>({id:String.fromCharCode(97+i),label})),
 purpose:'evidence',depth:0,sensitivity:'ordinary',estimatedSeconds:20,
 status:'published',source:'starter',preview:true,allowedResponses:['depends','neither','skip'],
 review:{type:'authored_seed',version:2},
 signals:options.map(([,value,statement,criterion],i)=>({optionId:String.fromCharCode(97+i),attributeKey:attribute,value,statement,scope,kind:'preference',strength:'direct',...(criterion?{criterion}:{})})),
});
export const starterEditionTwo=[
 question('rest-break','rest','breaks','After a draining day, what do you usually end up doing first?','after a draining day','rest.recovery.first',[
  ['Put on something familiar and keep to myself.','familiar_alone','You said you usually turn to something familiar on your own after a draining day.'],
  ['Reach out to someone I feel comfortable with.','familiar_company','You said you usually reach out to someone you feel comfortable with after a draining day.'],
  ['Do something with my hands to take my mind off the day.','hands_on','You said a hands-on activity is often your first move after a draining day.'],
  ['Go outside or move around for a bit.','movement','You said you often head outside or move around after a draining day.'],
  ['Keep scrolling, even when I meant to rest.','scrolling','You said you sometimes end up scrolling after a draining day, even when you meant to rest.'],
 ]),
 question('time-free-day','time','planning','You have a day with no plans. What are you most likely to do?','a day with no plans','time.unplanned_day.approach',[
  ['Choose one thing, then leave the rest open.','one_anchor','You chose one activity with room to decide the rest of an unplanned day.',criterion('Flexibility','travel','lifestyle','hobbies')],
  ["Make a plan so the day doesn't slip away.",'several_plans','You chose to give an unplanned day some structure.'],
  ['Wait and see what I feel like doing.','spontaneous','You chose to wait and see what feels right on an unplanned day.',criterion('Flexibility','travel','lifestyle','hobbies')],
  ["Catch up on things I've been putting off.",'catch_up','You chose catching up on postponed tasks for a day without plans.'],
  ['Let someone else suggest something.','others_suggest','You chose to let someone else suggest what to do on an unplanned day.'],
 ]),
 question('learning-puzzle','learning','starting',"Think of the last time a simple task wouldn't work. What did you do next?",'the last simple task that would not work','learning.stuck.response',[
  ['Kept trying different things until something worked.','experimented','You recalled trying different approaches when a simple task would not work.'],
  ['Looked up instructions or an example.','looked_up','You recalled looking up instructions or an example when a task would not work.',criterion('Worked examples','learning')],
  ['Asked someone to help me work it out.','asked_help','You recalled asking someone for help when a task would not work.'],
  ['Got frustrated and left it for later.','stepped_away','You recalled getting frustrated and leaving that task for later.'],
  ['Tried a shortcut, even if the result would be a bit messy.','shortcut','You recalled trying a shortcut, accepting a messier result for that task.'],
 ]),
 question('food-snack','food','novelty',"You're choosing something to eat, and a new option looks good. What tends to decide it?",'choosing food when a new option looks appealing','food.choice.priority',[
  ["I stick with a favorite; I know I'll enjoy it.",'familiar','You said a familiar favorite tends to win when a new food option also looks appealing.'],
  ["I try the new thing; I'm curious how it tastes.",'curious','You said curiosity tends to draw you toward an appealing new food option.'],
  ["The price matters more than whether it's familiar.",'price','You said price matters more than familiarity in this food choice.',criterion('Price','food')],
  ["I go with what's easy; I don't want to think about it.",'ease','You said an easy choice matters when you do not want to think much about food.'],
  ['My appetite that day matters more than either.','appetite','You said your appetite that day matters more than familiarity or novelty.'],
 ]),
 question('play-humor','play','humor','Think of something that made you laugh recently. What was it closest to?','something that made you laugh recently','play.recent_humor',[
  ['Something ridiculously unexpected.','absurd','You recalled laughing at something ridiculously unexpected.'],
  ['A sharp or sarcastic comment.','sarcastic','You recalled laughing at a sharp or sarcastic comment.'],
  ['Someone laughing at their own mistake.','own_mistake','You recalled laughing with someone about their own mistake.'],
  ['A small everyday thing we all recognize.','everyday','You recalled laughing at a recognizable everyday moment.'],
  ["An inside joke that wouldn't make sense to anyone else.",'inside_joke','You recalled an inside joke that depended on shared context.'],
 ]),
 question('creativity-postcard','creativity','starting',"You want to make something but aren't sure where to start. What do you tend to do?",'starting something creative','creativity.starting.approach',[
  ['Make a rough first attempt and see where it goes.','rough_attempt','You said you tend to start a creative task with a rough first attempt.',criterion('Room for a rough first attempt','hobbies','learning')],
  ['Start with one detail I already have in mind.','one_detail','You said you tend to start a creative task with one detail already in mind.'],
  ['Find an example I can adapt.','example','You said you tend to look for an example to adapt when starting a creative task.'],
  ['Work out what I want to say before I begin.','message','You said you tend to work out your message before beginning a creative task.'],
  ['Put it off; choosing where to start can be the hardest part.','put_off','You said you sometimes put off a creative task because choosing where to start is difficult.'],
 ]),
];
