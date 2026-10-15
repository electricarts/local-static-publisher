import React from 'react';
import path from 'path';
import ExportPanel from './ExportPanel';
import { LocalSite } from './types';

function StaticPublisherPage(props: any) {
  const siteId = props.match?.params?.siteID;
  const site = siteId ? props.sites?.[siteId] : undefined;

  if (!site) {
    return <div className="esp-route-page"><p className="esp-route-state">Loading site …</p></div>;
  }

  return <div className="esp-route-page"><ExportPanel site={site} /></div>;
}

export default function init(context: any): void {
  const { hooks } = context;
  const { NavLink, Route } = context.ReactRouter;
  const stylesheetPath = path.resolve(__dirname, '../style.css');

  hooks.addContent('stylesheets', () => <link rel="stylesheet" key="local-static-publisher-styles" href={stylesheetPath} />);
  hooks.addContent('SiteInfo_TabNav_Items', (site: LocalSite) => (
    <NavLink
      key="local-static-publisher-tab"
      exact={true}
      to={`/main/site-info/${site.id}/static-publisher`}
      activeClassName="active"
    >
      Static Publisher
    </NavLink>
  ));
  // Local 9/10 uses the bracketed route hook for the Site Info router. The
  // older routesSiteInfo spelling appears in legacy add-on examples but is
  // not consumed by current Local versions.
  hooks.addContent('routes[site-info]', ({ routeChildrenProps }: any = {}) => (
    <Route
      key="site-info-static-publisher"
      exact={true}
      path="/main/site-info/:siteID/static-publisher"
      render={(props: any) => <StaticPublisherPage {...props} {...routeChildrenProps} />}
    />
  ));
}
