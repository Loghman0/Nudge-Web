import {DISCOVERY_VERSIONS} from './catalog';
import {deriveDiscoveryObservations as derive,buildDiscoveryInsights as build} from './observation-core';
import type {DiscoveryAnswer} from './types';
export const deriveDiscoveryObservations=(answers:readonly DiscoveryAnswer[])=>derive(answers,DISCOVERY_VERSIONS);
export const buildDiscoveryInsights=(answers:readonly DiscoveryAnswer[])=>build(answers,DISCOVERY_VERSIONS);
