import {DISCOVERY_VERSIONS} from './catalog';
import {parseAnswersFromCatalog} from './validation';
export function parseDiscoveryAnswers(raw:unknown,options:{previewOnly?:boolean;maxAnswers?:number}={}){
 return parseAnswersFromCatalog(raw,DISCOVERY_VERSIONS,options);
}
