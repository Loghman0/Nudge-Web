/**
 * Conservative routing for explicit high-risk English requests, not a medical
 * classifier or a guarantee that every unsafe formulation will be recognized.
 * Run before candidate enrichment and persistence as well as manual comparison.
 */
export function decisionScopeError(text:string):string|null {
 const input=text.toLowerCase();
 if(/\b(kill myself|end my life|suicid(?:e|al)|self[- ]?harm|hurt myself|overdose)\b/.test(input))
  return "Your safety needs human support. If you may be in immediate danger, contact local emergency services and someone you trust. Nudge cannot rank actions that could harm you.";
 if(/\b(chest pain|cannot breathe|can't breathe|anaphylaxis|severe allergic reaction)\b/.test(input))
  return "This may need urgent medical attention. Contact local emergency medical services for immediate symptoms. Nudge cannot assess symptoms or rank treatment choices.";
 const treatment=/\b(medication|medicine|dose|insulin|antidepressant|antibiotic|prescription)\b/;
 const change=/\b(stop|skip|double|increase|decrease|change|quit|start|take)\b/;
 if(treatment.test(input)&&change.test(input))
  return "Medication and dose changes need guidance from your prescribing clinician or pharmacist. Nudge cannot rank these treatment choices.";
 if(/\b(allerg(?:y|ies|ic)|anaphylactic)\b/.test(input))
  return "Nudge's fit scores do not check allergy safety. Check ingredients and suitability with an appropriate medical professional; do not use a preference ranking to decide exposure.";
 if(/\b(invest|crypto|stocks|gambl(?:e|ing)|bet)\b/.test(input)&&/\b(life savings|all my savings|rent money|tuition money|emergency funds?|borrow(?:ed)? money)\b/.test(input))
  return "Nudge cannot assess the suitability of risking essential or borrowed money. Review the risks and obligations with a qualified financial adviser before making that commitment.";
 if(/\b(plead guilty|waive my rights|sign (?:a |the )?settlement|accept (?:a |the )?settlement)\b/.test(input))
  return "This choice can affect your legal rights. Get advice from a qualified legal professional; Nudge cannot rank legal commitments.";
 if(/\b(abusive|violent)\b.{0,40}\b(partner|spouse|relationship)\b|\b(partner|spouse)\b.{0,40}\b(abusive|violent)\b/.test(input))
  return "Your safety comes first. If there is immediate danger, contact local emergency services. A trusted person or qualified local support service can help you consider safe next steps; Nudge cannot rank this situation.";
 return null;
}
