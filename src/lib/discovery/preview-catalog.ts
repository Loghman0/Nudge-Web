import catalog from '../../../data/discovery-preview.json';
import history from '../../../data/discovery-history.json';
import type {DiscoveryQuestion} from './types';
export const PREVIEW_QUESTIONS=catalog as DiscoveryQuestion[];
export const PREVIEW_VERSIONS=[...PREVIEW_QUESTIONS,...history as DiscoveryQuestion[]];
export const PREVIEW_EDITION=3;
export function previewQuestionsForEdition(edition=PREVIEW_EDITION){return edition===PREVIEW_EDITION?PREVIEW_QUESTIONS:PREVIEW_VERSIONS.filter(q=>q.preview&&q.version===edition);}
