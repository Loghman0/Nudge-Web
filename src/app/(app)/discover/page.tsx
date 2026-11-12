import {redirect} from 'next/navigation';
/** One question experience; existing decision-memory checks remain at /discover/checks. */
export default function DiscoverPage(){redirect('/dashboard');}
