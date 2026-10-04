import { useEffect, useState } from 'react';
import { Layout, Menu, Spin, Typography, App as AntApp, Button, Space, Segmented, Tag } from 'antd';
import {
  CompassOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  ExperimentOutlined,
  ProfileOutlined,
  BarsOutlined,
  InboxOutlined,
  AppstoreOutlined,
  ToolOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { seedIfEmpty } from './utils/seed';
import { downloadText, exportBackupJson } from './utils/export';
import { useHoleStore } from './stores/holeStore';
import { useRunStore } from './stores/runStore';
import { useBoxStore } from './stores/boxStore';
import { useLithoStore } from './stores/lithoStore';
import { useLocationStore } from './stores/locationStore';
import { useIntakeStore } from './stores/intakeStore';
import { useRoleStore } from './stores/roleStore';

const { Header, Sider, Content, Footer } = Layout;
const { Title, Text } = Typography;

const MENU_ITEMS = [
  { key: '/', icon: <CompassOutlined />, label: <Link to="/">工作台</Link> },
  { key: '/holes', icon: <DatabaseOutlined />, label: <Link to="/holes">钻孔台帐</Link> },
  { key: '/runs', icon: <BarsOutlined />, label: <Link to="/runs">回次记录</Link> },
  { key: '/boxes', icon: <ProfileOutlined />, label: <Link to="/boxes">岩芯箱</Link> },
  { key: '/intake', icon: <InboxOutlined />, label: <Link to="/intake">入库管理</Link> },
  { key: '/locations', icon: <AppstoreOutlined />, label: <Link to="/locations">库位管理</Link> },
  { key: '/lithology', icon: <ExperimentOutlined />, label: <Link to="/lithology">岩性编录</Link> },
];

/** 应用外壳：左侧导航 + 顶部导出备份，负责一次性的本地数据装载 */
export default function App() {
  const { message } = AntApp.useApp();
  const [ready, setReady] = useState(false);
  const hydrateHoles = useHoleStore((s) => s.hydrate);
  const hydrateRuns = useRunStore((s) => s.hydrate);
  const hydrateBoxes = useBoxStore((s) => s.hydrate);
  const hydrateLithos = useLithoStore((s) => s.hydrate);
  const hydrateLocations = useLocationStore((s) => s.hydrate);
  const hydrateIntake = useIntakeStore((s) => s.hydrate);
  const role = useRoleStore((s) => s.role);
  const hydrateRole = useRoleStore((s) => s.hydrate);
  const setRole = useRoleStore((s) => s.setRole);
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    hydrateRole();
    (async () => {
      try {
        await seedIfEmpty();
        await Promise.all([hydrateHoles(), hydrateRuns(), hydrateBoxes(), hydrateLithos(), hydrateLocations(), hydrateIntake()]);
      } catch (error) {
        message.error(`本地数据装载失败：${(error as Error).message}`);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [hydrateHoles, hydrateRuns, hydrateBoxes, hydrateLithos, hydrateLocations, hydrateIntake, hydrateRole, message]);

  const selectedKey =
    MENU_ITEMS.map((item) => item.key)
      .filter((key) => (key === '/' ? location.pathname === '/' : location.pathname.startsWith(key)))
      .sort((a, b) => b.length - a.length)[0] ?? '/';

  const handleExport = async () => {
    const json = await exportBackupJson();
    downloadText(`gbdrillcore-backup-${new Date().toISOString().slice(0, 10)}.json`, json);
    message.success('已导出 IndexedDB 全量 JSON 备份');
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0" width={204} style={{ background: '#2b3a46' }}>
        <div style={{ padding: '16px 16px 8px' }}>
          <Title level={5} style={{ color: '#fff', margin: 0 }}>
            钻孔岩芯编目台
          </Title>
          <Text style={{ color: '#9fb4c2', fontSize: 12 }}>gbdrillcore · 纯前端本地存储</Text>
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[selectedKey]} items={MENU_ITEMS} style={{ background: 'transparent' }} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text strong>矿区钻孔岩芯编目台</Text>
          <Space>
            <Tag color={role === 'keeper' ? 'gold' : 'blue'} style={{ marginInlineEnd: 0 }}>
              {role === 'keeper' ? <ToolOutlined /> : <TeamOutlined />} 当前岗位：{role === 'keeper' ? '库房管理员' : '钻探班组'}
            </Tag>
            <Segmented
              size="small"
              value={role}
              onChange={(value) => setRole(value as 'crew' | 'keeper')}
              options={[
                { label: '钻探班组', value: 'crew' },
                { label: '库房管理员', value: 'keeper' },
              ]}
            />
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              导出备份
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 16 }}>
          {ready ? (
            <Outlet />
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
              <Spin size="large" />
            </div>
          )}
        </Content>
        <Footer style={{ textAlign: 'center', color: '#8a99a5', padding: '12px 0' }}>
          数据保存在浏览器 IndexedDB（gbdrillcore-db），不依赖后端服务
        </Footer>
      </Layout>
    </Layout>
  );
}
