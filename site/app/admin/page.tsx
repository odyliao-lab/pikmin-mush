import { chatGPTSignOutPath, requireChatGPTUser } from "../chatgpt-auth";
import Link from "next/link";
import { isAdminEmail } from "../../lib/cloud";
import AdminClient from "./admin-client";
import styles from "./admin.module.css";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireChatGPTUser("/admin");
  if (!isAdminEmail(user.email)) {
    return (
      <main className={styles.denied}>
        <div>
          <span className={styles.kicker}>Pikmin 蘑菇雷達</span>
          <h1>此帳號沒有後台權限</h1>
          <p>{user.email}</p>
          <Link href="/">回到公開地圖</Link>
        </div>
      </main>
    );
  }
  return (
    <AdminClient
      displayName={user.displayName}
      signOutPath={chatGPTSignOutPath("/")}
    />
  );
}
