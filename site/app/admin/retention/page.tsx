import {requireChatGPTUser} from '../../chatgpt-auth';
import {isAdminEmail} from '../../../lib/cloud';
import RetentionClient from './retention-client';
export const dynamic='force-dynamic';
export default async function RetentionPage(){
  const user=await requireChatGPTUser('/admin/retention');
  if(!isAdminEmail(user.email))return <main>此帳號沒有後台權限。</main>;
  return <RetentionClient/>;
}
