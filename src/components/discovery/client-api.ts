'use client';
export async function discoveryRequest<T>(path:string,body?:unknown,method=body?'POST':'GET'):Promise<T>{
 const response=await fetch(`/api/v1/discovery/${path}`,{method,cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'Could not finish this step. Try again.');return result as T;
}
