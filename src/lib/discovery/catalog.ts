import catalog from '../../../data/discovery-catalog.json';
import history from '../../../data/discovery-history.json';
import preview from '../../../data/discovery-preview.json';
import type { DiscoveryQuestion } from './types';
export const DISCOVERY_CATALOG = catalog as DiscoveryQuestion[];
export const DISCOVERY_VERSIONS = [...DISCOVERY_CATALOG,...history as DiscoveryQuestion[]];
export const PREVIEW_QUESTIONS = preview as DiscoveryQuestion[];
export function getDiscoveryQuestion(id: string, version?: number): DiscoveryQuestion | undefined {
  return (version===undefined?DISCOVERY_CATALOG:DISCOVERY_VERSIONS).find(question => question.id === id && (version === undefined || question.version === version));
}
