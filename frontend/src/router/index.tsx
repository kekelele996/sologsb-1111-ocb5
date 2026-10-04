import type { RouteObject } from 'react-router-dom';
import { Button, Result } from 'antd';
import App from '../App';
import HoleBoard from '../pages/HoleBoard';
import HoleList from '../pages/HoleList';
import RunLog from '../pages/RunLog';
import CoreBoxList from '../pages/CoreBoxList';
import IntakeDesk from '../pages/IntakeDesk';
import LocationBoard from '../pages/LocationBoard';
import LithoEditor from '../pages/LithoEditor';

function NotFound() {
  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="请从左侧菜单进入矿区钻孔岩芯编目台的各功能页"
      extra={
        <Button type="primary" href="/">
          返回工作台
        </Button>
      }
    />
  );
}

/** 全部路由：工作台 + 钻孔台帐 / 回次记录 / 岩芯箱 / 入库管理 / 库位管理 / 岩性编录 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HoleBoard /> },
      { path: 'holes', element: <HoleList /> },
      { path: 'runs', element: <RunLog /> },
      { path: 'boxes', element: <CoreBoxList /> },
      { path: 'intake', element: <IntakeDesk /> },
      { path: 'locations', element: <LocationBoard /> },
      { path: 'lithology', element: <LithoEditor /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export default routes;
