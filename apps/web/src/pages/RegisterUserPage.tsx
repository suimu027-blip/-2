import { type FormEvent, useState } from "react";
import type { User, RegisterUserRequest, RegisterUserResponse } from "@verivote/shared";
import { apiRequest, getErrorMessage, NoticeMessage, type Notice } from "../common";

interface RegisterUserPageProps {
  title?: string;
  description?: string;
}

export function RegisterUserPage({
  title = "用户注册",
  description
}: RegisterUserPageProps = {}) {
  const [name, setName] = useState("");
  const [registeredUser, setRegisteredUser] = useState<User | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    try {
      const body: RegisterUserRequest = { name };
      const data = await apiRequest<RegisterUserResponse>("/users/register", {
        method: "POST",
        body
      });

      setName("");
      setRegisteredUser(data.user);
      setNotice({ type: "success", text: "用户注册成功" });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">User</p>
          <h1>{title}</h1>
        </div>
      </div>

      {description ? <p className="page-lead">{description}</p> : null}

      <NoticeMessage notice={notice} />

      <form className="panel form narrow" onSubmit={handleRegister}>
        <label>
          用户名
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="输入用户名"
          />
        </label>
        <button type="submit">注册</button>
      </form>

      {registeredUser ? (
        <div className="panel result-box">
          <h2>userId</h2>
          <code>{registeredUser.id}</code>
          <p>{registeredUser.name}</p>
        </div>
      ) : null}
    </section>
  );
}
