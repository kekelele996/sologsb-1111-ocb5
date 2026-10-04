import { create } from 'zustand';

/** 操作台角色：钻探班组（装箱/申请）与库房管理员（编库位/确认上架/退回） */
export type Role = 'crew' | 'keeper';

const STORAGE_KEY = 'gbdrillcore-role';

interface RoleState {
  role: Role;
  hydrate: () => void;
  setRole: (role: Role) => void;
}

function readRole(): Role {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'keeper' ? 'keeper' : 'crew';
  } catch {
    return 'crew';
  }
}

/** 当前操作角色（无后端，仅用于区分两岗操作权限，本地记忆） */
export const useRoleStore = create<RoleState>()((set) => ({
  role: 'crew',
  hydrate: () => set({ role: readRole() }),
  setRole: (role) => {
    try {
      localStorage.setItem(STORAGE_KEY, role);
    } catch {
      /* 忽略无痕模式写入失败 */
    }
    set({ role });
  },
}));
