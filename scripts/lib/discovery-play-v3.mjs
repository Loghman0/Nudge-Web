import {choice,signal,criterion} from './discovery-question-kit.mjs';

// Must stay byte-identical to the definition inserted by 00023_play_session_question.sql.
export const playSessionV3=choice('play-humor','play','games','You have an hour to play. What would make it feel like time well spent?',[
 'Build or make something, like Minecraft.','Compete and climb ranks, like Fortnite.','Something calm I can drop into without effort.','Whatever friends are playing, so I can join them.','A game I have never tried before.',
],{
 version:3,estimatedSeconds:20,preview:true,review:{type:'authored_seed',version:3},
 signals:[
  signal('a','play.session.preference','creation','You said an hour of play feels well spent when you can build or make something, like Minecraft.','an hour of free play',criterion('Room to create','play','hobbies','creativity')),
  signal('b','play.session.preference','competition','You said an hour of play feels well spent when you can compete and climb ranks, like Fortnite.','an hour of free play',criterion('Competition and rank','play','hobbies')),
  signal('c','play.session.preference','ease','You said an hour of play feels well spent when it is calm and easy to drop into.','an hour of free play',criterion('Low effort to start','play','hobbies','rest')),
  signal('d','play.session.preference','company','You said an hour of play feels well spent when it lets you join friends.','an hour of free play',criterion('Playing with friends','play','relationships')),
  signal('e','play.session.preference','novelty','You said an hour of play feels well spent when it is something new to try.','an hour of free play',criterion('Something new to try','play','hobbies')),
 ],
});