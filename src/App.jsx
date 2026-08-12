import { useState, useMemo, useRef } from "react";
import { useLiveData, adaptSummary, adaptMonthly, adaptDaily, adaptShifts, adaptAgents, adaptCats, adaptFleet } from "./useLiveData";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area, PieChart, Pie, Cell, Legend } from "recharts";

if (typeof document !== "undefined" && !document.getElementById("zra-fonts")) {
  const lk = document.createElement("link");
  lk.id = "zra-fonts"; lk.rel = "stylesheet";
  lk.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Fira+Code:wght@400;500&display=swap";
  document.head.appendChild(lk);
}

const D = {
  page:"#F8FAFF", card:"#FFFFFF", sidebar:"#0F2356", sidebarH:"#1A3070", sidebarA:"#1D4ED8",
  p:"#1D4ED8", pLt:"#DBEAFE", pDk:"#1E3A8A",
  a:"#D97706", aLt:"#FEF3C7",
  ok:"#16A34A", okBg:"#DCFCE7",
  wn:"#D97706", wnBg:"#FEF3C7",
  er:"#DC2626", erBg:"#FEF2F2",
  pu:"#7C3AED", puBg:"#EDE9FE",
  cy:"#0891B2",
  t1:"#0F172A", t2:"#475569", t3:"#94A3B8",
  sN:"#93C5FD", sA:"#FFFFFF", sSec:"#60A5FA",
  bd:"#E2E8F0", div:"#F1F5F9",
  sh1:"0 1px 3px rgba(15,35,86,0.07)",
  sh2:"0 4px 14px rgba(15,35,86,0.10)",
  r:8, rs:4, sw:220, hh:56,
  f:"'Inter',system-ui,sans-serif",
  fm:"'Fira Code','Courier New',monospace",
};

const CC = {
  "Generic Error":"#DC2626","Battery & Charging":"#D97706","Navigation & Localization":"#1D4ED8",
  "Robot Hardware":"#16A34A","Sensors":"#7C3AED","Parts & Logistics":"#64748B",
  "Connectivity":"#0891B2","Service Request":"#0284C7","Information Request":"#6D28D9",
  "Mapping":"#EA580C","Software / Firmware":"#9F1239","Fleet / Site Issues":"#059669",
  "Others":"#6B7280","Test":"#94A3B8","Invalid Tickets":"#CBD5E1",
};

const FX = {ID:0,DT:1,CS:2,OW:3,LV:4,ST:5,TY:6,RB:7,IS:8};

const RAW = [["#19","2026-06-22","Catalent Pharma Solutions","Sahil","L3","solved","Parts & Logistics",null,"Return shipment & tracking for IoT button"],["#36","2026-06-22","SICK PCA","Sanath","L1","solved","Sensors",null,"Sensors on two Fetch Robots not visible"],["#37","2026-06-23","GARMIN INTERNATIONAL, INC.","Sanath","L1","solved","Mapping",null,"A-Factory Mapping not loading routes"],["#38","2026-06-23","DORMAN PRODUCTS","Sanath","L3","in progress","Parts & Logistics",null,"Replacement for malfunctioning CC100 charger"],["#41","2026-06-23","Peak Technologies LLC","Sahil","L3","pending","Service Request",null,"Unable to access Symmetry"],["#42","2026-06-23","Lexter Italia Srl","Sanath","L3","in progress","Robot Hardware",null,"L3 damage assessment after AMR crash"],["#50","2026-06-24","Arrow Electronics, Inc.","Vaishnav","L3","solved","Robot Hardware",null,"Hardware degrading/overheating"],["#51","2026-06-24","Vistaprint","Sahil","L3","solved","Battery & Charging","AMR-2398","AMR 2398 went offline multiple times"],["#53","2026-06-26","Catalent Pharma Solutions","Sahil","L3","solved","Navigation & Localization","AMR-2398","AMR 2398 offline multiple times night shift"],["#54","2026-06-27","Lexter Italia Srl","Sahil","L3","solved","Battery & Charging","AMR-1692","AMR 1692 serious battery problems"],["#55","2026-06-28","Network Operations Center","Sahil","L3","solved","Information Request",null,"Question about Spacing for Cart Staging"],["#60","2026-06-25","SICK PCA","Vaishnav","L3","in progress","Sensors","freight100-1801","Fetch robot 100-1801 sensor issue"],["#74","2026-06-25","Truck Country","Vaishnav","L3","solved","Battery & Charging",null,"Recurring Failures Charging Offline Navigation"],["#75","2026-06-25","Marmon Foodservice Technologies","Sreekanth","L3","in progress","Navigation & Localization",null,"Robot mis-localized"],["#77","2026-06-25","Stoops Indy","Sreekanth","L3","in progress","Robot Hardware",null,"Recurring Failures Charging Offline Navigation"],["#79","2026-06-25","Lexter Italia Srl","Sreekanth","L3","in progress","Robot Hardware","freight100-2424","Error Board Overtemp"],["#80","2026-06-25","Tufts University","Sreekanth","L3","solved","Battery & Charging",null,"Computers not booting"],["#85","2026-06-26","Inventive LLC","Sahil","L3","pending","Battery & Charging","freight100-2258","Robot 2258 failing to charge"],["#86","2026-06-29","ROOTS EDUCATION CO LLC","Sahil","L3","in progress","Battery & Charging","freight100-2225","Robot 100-2225 not charging"],["#87","2026-06-29","Inventive LLC","Sahil","L3","solved","Parts & Logistics","freight100-2106","Robot 100-2106 down"],["#88","2026-06-29","Arrow Electronics, Inc.","Sahil","L3","in progress","Sensors","AMR-1924","AMR 1924 front damage"],["#89","2026-06-29","Arrow Electronics, Inc.","Sahil","L3","in progress","Battery & Charging",null,"Charging Station Port Retention Pin Failure"],["#90","2026-06-29","Network Operations Center","Sahil","L3","in progress","Battery & Charging",null,"3 New Issues AMR Incident Hardware Issues"],["#91","2026-06-29","Truck Country","Sahil","L3","solved","Fleet / Site Issues",null,"Robots on charger unnecessarily"],["#92","2026-06-29","Network Operations Center","Sahil","L3","in progress","Mapping",null,"Assistance with Map Update"],["#93","2026-06-29","Arrow Electronics, Inc.","Sahil","L3","in progress","Parts & Logistics","freight100-2212","Robot 2212 not making sound"],["#94","2026-06-29","Network Operations Center","Sahil","L3","solved","Robot Hardware",null,"Robot 2 DEAD"],["#95","2026-06-29","GARMIN INTERNATIONAL, INC.","Sahil","L3","solved","Parts & Logistics",null,"Blue Safety Light Quote"],["#96","2026-06-29","Apple Inc","Sreekanth","L3","solved","Robot Hardware","freight100-1745","Robot 100-1745 not able to turn ON"],["#97","2026-06-29","Network Operations Center","Sahil","L3","solved","Battery & Charging",null,"C100 charger 1034"],["#98","2026-06-29","Stuller, Inc","Sahil","L3","in progress","Battery & Charging","freight100-1900","Robot 1900 failed before scheduled time"],["#99","2026-06-29","Arrow Electronics, Inc.","Sahil","L3","in progress","Fleet / Site Issues",null,"Several robots failed to execute next instruction"],["#100","2026-06-29","Cornell University","Sahil","L3","in progress","Information Request",null,"Robotics Product Setup inquiry"],["#101","2026-06-29","CARNEGIE MELLON UNIVERSITY","Sahil","L3","solved","Battery & Charging",null,"Fetch mobile base charging error"],["#112","2026-06-30","Arrow Electronics, Inc.","Sanath","L3","solved","Generic Error","freight100-2620","LOAD RollerTop action timed-out"],["#113","2026-06-30","Truck Country","Sanath","L3","solved","Connectivity",null,"ROBOTS NO WIFI CONNECTION"],["#114","2026-06-30","GE APPLIANCES","Sanath","L1","solved","Robot Hardware","freight100-1642","Robot Offline"],["#115","2026-06-30","Meyer Tool, Inc.","Sanath","L1","solved","Generic Error","freight100-2044","Robot Offline"],["#118","2026-06-30","Meyer Tool, Inc.","Vaishnav","L1","solved","Generic Error","freight100-1935","Robot Offline"],["#119","2026-07-01","Meyer Tool, Inc.","Vaishnav","L1","solved","Navigation & Localization","freight100-2083","Robot Not Localized"],["#120","2026-07-01","Meyer Tool, Inc.","Vaishnav","L1","solved","Generic Error","freight100-2128","Did not complete task with payload"],["#122","2026-07-01","Truck Country","Vaishnav","L3","solved","Connectivity",null,"Robot Network Connectivity"],["#125","2026-07-01","GE APPLIANCES","Sreekanth","L1","solved","Battery & Charging","freight100-1216","Low Battery Warning 35%"],["#128","2026-07-01","GARMIN INTERNATIONAL, INC.","Sreekanth","L3","in progress","Information Request",null,"Request for Quote"],["#129","2026-07-01","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Generic Error","freight100-1311","Forcing ABORT on condition-dependent failure"],["#130","2026-07-01","GARMIN INTERNATIONAL, INC.","Sanath","L1","solved","Generic Error","freight100-1291","Did not complete undock"],["#131","2026-07-02","GARMIN INTERNATIONAL, INC.","Sanath","L1","solved","Generic Error","freight100-1291","Automatic alert GENERIC_ERROR"],["#132","2026-07-02","GARMIN INTERNATIONAL, INC.","Sanath","L1","solved","Navigation & Localization","freight100-1291","Robot Not Localized"],["#133","2026-07-02","GARMIN INTERNATIONAL, INC.","Sanath","L1","solved","Generic Error","freight100-1291","Did not complete undock"],["#134","2026-07-02","GARMIN INTERNATIONAL, INC.","Sanath","L3","solved","Generic Error","freight100-1291","Did not complete undock"],["#135","2026-07-02","GARMIN INTERNATIONAL, INC.","Sahil","L1","solved","Navigation & Localization","freight100-1291","Robot Not Localized"],["#136","2026-07-02","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2293","Did not complete precision undock"],["#137","2026-07-02","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Generic Error","freight100-1311","Automatic alert GENERIC_ERROR"],["#138","2026-07-02","Catalent Pharma Solutions","Vaishnav","L3","in progress","Navigation & Localization",null,"Robots mislocalized not going to charge"],["#141","2026-07-03","GARMIN INTERNATIONAL, INC.","Sahil","L1","solved","Generic Error","freight100-1311","Forcing ABORT"],["#142","2026-07-03","Network Operations Center","Sahil","L1","solved","Information Request",null,"Update regarding Support Case"],["#145","2026-07-03","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2432","Did not complete precision undock"],["#146","2026-07-03","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-2131","charge_level field NaN"],["#147","2026-07-03","Arrow Electronics, Inc.","Sahil","L3","solved","Generic Error","freight100-2131","UNLOAD RollerTop canceled with payload"],["#148","2026-07-06","GARMIN INTERNATIONAL, INC.","Sahil","L1","solved","Robot Hardware","freight100-1201","Motor error MOTOR OVERTEMP"],["#149","2026-07-06","GARMIN INTERNATIONAL, INC.","Sahil","L1","solved","Robot Hardware","freight100-1201","Motor error MOTOR OVERTEMP"],["#150","2026-07-06","GARMIN INTERNATIONAL, INC.","Sahil","L1","solved","Robot Hardware","freight100-1201","Motor error MOTOR OVERTEMP"],["#151","2026-07-06","GARMIN INTERNATIONAL, INC.","Sahil","L1","solved","Robot Hardware","freight100-1201","Motor error MOTOR OVERTEMP"],["#152","2026-07-06","GARMIN INTERNATIONAL, INC.","Sahil","L1","solved","Robot Hardware","freight100-1201","Motor error MOTOR OVERTEMP"],["#153","2026-07-06","GARMIN INTERNATIONAL, INC.","Sahil","L1","solved","Navigation & Localization","freight100-1201","Robot Not Localized"],["#154","2026-07-06","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Generic Error","freight100-1201","charge_level NaN hardware sensor fault"],["#155","2026-07-06","GE APPLIANCES","Sreekanth","L1","solved","Navigation & Localization","freight100-1642","Robot Not Localized"],["#157","2026-07-07","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-2620","Did not complete precision undock"],["#159","2026-07-07","Arrow Electronics, Inc.","Sahil","L3","solved","Generic Error","freight100-2241","Did not complete precision undock"],["#160","2026-07-07","GARMIN INTERNATIONAL, INC.","Sanath","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#161","2026-07-07","GE APPLIANCES","Sanath","L1","solved","Navigation & Localization","freight100-2047","Robot Not Localized"],["#162","2026-07-07","ABB","Sanath","L3","solved","Information Request",null,"ABB Westville Fetch Leases"],["#163","2026-07-07","Arrow Electronics, Inc.","Sanath","L3","solved","Generic Error","freight100-2281","LOAD RollerTop action timed-out"],["#164","2026-07-07","Apple Inc","Sanath","L3","solved","Parts & Logistics",null,"Robot not able to turn ON"],["#165","2026-07-07","Arrow Electronics, Inc.","Sanath","L1","solved","Generic Error","freight100-2281","LOAD RollerTop action timed-out"],["#166","2026-07-07","GARMIN INTERNATIONAL, INC.","Sanath","L1","solved","Robot Hardware","freight100-1291","Motor error MOTOR OVERTEMP"],["#168","2026-07-07","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Navigation & Localization","freight100-1291","Robot Not Localized"],["#169","2026-07-07","DORMAN PRODUCTS","Vaishnav","L3","solved","Parts & Logistics",null,"100-1957 not powering on"],["#170","2026-07-07","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-2620","LOAD RollerTop action timed-out"],["#172","2026-07-08","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-2280","Did not complete precision undock"],["#173","2026-07-08","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#174","2026-07-08","GE APPLIANCES","Vaishnav","L1","solved","Battery & Charging","freight100-1642","Low Battery Warning 35%"],["#175","2026-07-08","Arrow Electronics, Inc.","Vaishnav","L3","solved","Parts & Logistics","freight100-2442","Robot computer not booting"],["#176","2026-07-08","Arrow Electronics, Inc.","Vaishnav","L3","in progress","Battery & Charging","freight100-2280","Robot 2280 showing 90% charge but dying"],["#177","2026-07-08","GE APPLIANCES","Sreekanth","L3","solved","Generic Error","freight100-2047","Lost connection to camera downward"],["#178","2026-07-08","GE APPLIANCES","Sreekanth","L1","solved","Navigation & Localization","freight100-2047","Robot Not Localized"],["#179","2026-07-08","GE APPLIANCES","Sreekanth","L1","solved","Navigation & Localization","freight100-2047","Robot Not Localized"],["#180","2026-07-08","GE APPLIANCES","Sreekanth","L1","solved","Navigation & Localization","freight100-2047","Robot Not Localized"],["#181","2026-07-08","GE APPLIANCES","Sreekanth","L1","solved","Navigation & Localization","freight100-2047","Robot Not Localized"],["#182","2026-07-08","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Robot Hardware","freight100-1311","Motor error BOARD OVERTEMP"],["#183","2026-07-08","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Robot Hardware","freight100-1311","Motor error BOARD OVERTEMP"],["#184","2026-07-08","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Robot Hardware","freight100-1311","Motor error BOARD OVERTEMP"],["#185","2026-07-08","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Robot Hardware","freight100-1311","Motor error BOARD OVERTEMP"],["#186","2026-07-08","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Robot Hardware","freight100-1311","Motor error BOARD OVERTEMP"],["#187","2026-07-08","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Robot Hardware","freight100-1311","Motor error BOARD OVERTEMP"],["#188","2026-07-08","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Robot Hardware","freight100-1311","Motor error BOARD OVERTEMP"],["#189","2026-07-08","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Navigation & Localization","freight100-1311","Robot Not Localized"],["#190","2026-07-08","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#191","2026-07-08","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Generic Error","freight100-1292","Could not escape from cart"],["#192","2026-07-08","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2293","UNLOAD RollerTop timed-out"],["#193","2026-07-08","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2453","UNLOAD RollerTop timed-out"],["#195","2026-07-08","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2452","Did not complete precision undock"],["#196","2026-07-08","GE APPLIANCES","Sanath","L1","solved","Navigation & Localization","freight100-2047","Robot Not Localized"],["#197","2026-07-09","GE APPLIANCES","Sanath","L1","solved","Battery & Charging","freight100-1642","Low Battery Warning 35%"],["#198","2026-07-09","GARMIN INTERNATIONAL, INC.","Sanath","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#199","2026-07-09","GARMIN INTERNATIONAL, INC.","Sahil","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#200","2026-07-09","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2244","Did not complete undock"],["#201","2026-07-09","GE APPLIANCES","Sreekanth","L1","solved","Navigation & Localization","freight100-1642","Robot Not Localized"],["#202","2026-07-09","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2303","LOAD RollerTop canceled with payload"],["#203","2026-07-09","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2303","LOAD RollerTop canceled with payload"],["#204","2026-07-09","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2303","LOAD RollerTop canceled with payload"],["#205","2026-07-09","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2303","LOAD RollerTop canceled with payload"],["#206","2026-07-09","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2303","LOAD RollerTop canceled with payload"],["#207","2026-07-09","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2303","LOAD RollerTop canceled with payload"],["#209","2026-07-09","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Generic Error","freight100-1311","Forcing ABORT"],["#210","2026-07-09","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#215","2026-07-09","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-2280","LOAD RollerTop action failed"],["#216","2026-07-10","GE APPLIANCES","Vaishnav","L1","solved","Mapping","freight100-1642","Robot Not Localized"],["#217","2026-07-10","GE APPLIANCES","Vaishnav","L3","solved","Generic Error","freight100-1216","Could not initialize bluetooth radio"],["#218","2026-07-10","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-2303","UNLOAD RollerTop timed-out"],["#219","2026-07-10","Arrow Electronics, Inc.","Vaishnav","L1","solved","Generic Error","freight100-2303","LOAD RollerTop timed-out"],["#220","2026-07-10","Arrow Electronics, Inc.","Sreekanth","L1","solved","Generic Error","freight100-2303","LOAD RollerTop timed-out"],["#221","2026-07-10","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2281","Motor error MOTOR PHASE CURRENT"],["#222","2026-07-10","Arrow Electronics, Inc.","Sreekanth","L1","solved","Generic Error","freight100-2281","Motor error MOTOR PHASE CURRENT"],["#223","2026-07-10","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2281","Did not complete precision undock"],["#225","2026-07-11","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-2303","Did not complete precision undock"],["#226","2026-07-11","Arrow Electronics, Inc.","Vaishnav","L1","solved","Generic Error","freight100-2303","Did not complete precision undock"],["#227","2026-07-11","Arrow Electronics, Inc.","Vaishnav","L1","solved","Generic Error","freight100-2303","Did not complete precision undock"],["#228","2026-07-11","Arrow Electronics, Inc.","Vaishnav","L1","solved","Generic Error","freight100-2303","Did not complete precision undock"],["#229","2026-07-11","Arrow Electronics, Inc.","Vaishnav","L1","solved","Generic Error","freight100-2303","Did not complete precision undock"],["#230","2026-07-11","Arrow Electronics, Inc.","Vaishnav","L1","solved","Generic Error","freight100-2303","Did not complete precision undock"],["#234","2026-07-11","Arrow Electronics, Inc.","Vaishnav","L1","solved","Generic Error","freight100-2303","LOAD RollerTop canceled with payload"],["#235","2026-07-11","Arrow Electronics, Inc.","Vaishnav","L1","solved","Generic Error","freight100-2303","LOAD RollerTop canceled with payload"],["#236","2026-07-11","Arrow Electronics, Inc.","Vaishnav","L1","solved","Generic Error","freight100-2432","LOAD RollerTop action failed"],["#237","2026-07-11","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-2131","LOAD RollerTop timed-out"],["#238","2026-07-11","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-1700","LOAD RollerTop timed-out"],["#239","2026-07-11","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-1700","Did not complete precision undock"],["#240","2026-07-11","GE APPLIANCES","Vaishnav","L1","solved","Navigation & Localization","freight100-2047","Robot Not Localized"],["#241","2026-07-11","Arrow Electronics, Inc.","Sahil","L3","solved","Generic Error","freight100-2303","Did not complete precision undock"],["#242","2026-07-11","GE APPLIANCES","Sahil","L1","solved","Navigation & Localization","freight100-2047","Robot Not Localized"],["#243","2026-07-11","GARMIN INTERNATIONAL, INC.","Sahil","L1","solved","Battery & Charging","freight100-1201","Low Battery Warning 35%"],["#244","2026-07-11","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Battery & Charging","freight100-1201","Low Battery Warning 35%"],["#245","2026-07-11","GE APPLIANCES","Vaishnav","L1","solved","Battery & Charging","freight100-2047","Low Battery Warning"],["#246","2026-07-11","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Generic Error","freight100-1546","Could not escape from cart"],["#248","2026-07-12","GARMIN INTERNATIONAL, INC.","Sanath","L1","solved","Battery & Charging","freight100-1546","Low Battery Warning 35%"],["#249","2026-07-12","GARMIN INTERNATIONAL, INC.","Sanath","L1","solved","Battery & Charging","freight100-1546","Low Battery Warning 35%"],["#250","2026-07-12","GARMIN INTERNATIONAL, INC.","Sanath","L1","solved","Navigation & Localization","freight100-1546","Robot Not Localized"],["#251","2026-07-12","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Navigation & Localization","freight100-1544","Robot Not Localized"],["#252","2026-07-12","Meyer Tool, Inc.","Sahil","L3","solved","Software / Firmware",null,"Ceiling photos"],["#253","2026-07-13","Balloon One Solutions Ltd","Sahil","L3","in progress","Information Request",null,"Request for Additional Robot Analytics Data"],["#254","2026-07-13","GE APPLIANCES","Sreekanth","L1","solved","Navigation & Localization","freight100-2047","Robot Not Localized"],["#255","2026-07-13","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Navigation & Localization","freight100-1291","Robot Not Localized"],["#257","2026-07-13","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#258","2026-07-13","Vistaprint","Sreekanth","L3","solved","Battery & Charging","AMR-2398","AMR 2398 error and powering off"],["#259","2026-07-13","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Generic Error","freight100-1292","Could not escape from cart"],["#260","2026-07-13","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-2452","LOAD RollerTop action failed"],["#261","2026-07-13","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2244","UNLOAD RollerTop timed-out"],["#262","2026-07-13","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-2432","Did not complete precision undock"],["#263","2026-07-14","GE APPLIANCES","Vaishnav","L1","solved","Navigation & Localization","freight100-2047","Robot Not Localized"],["#264","2026-07-14","GE APPLIANCES","Vaishnav","L1","solved","Navigation & Localization","freight100-2047","Robot Not Localized"],["#265","2026-07-14","GE APPLIANCES","Vaishnav","L1","solved","Navigation & Localization","freight100-2047","Robot Not Localized"],["#266","2026-07-14","Dynabrade","Vaishnav","L1","solved","Generic Error","freight100-2360","Did not complete task with payload"],["#267","2026-07-14","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-2321","LOAD RollerTop timed-out"],["#268","2026-07-14","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Navigation & Localization","freight100-1291","Robot Not Localized"],["#269","2026-07-14","Inventive LLC","Vaishnav","L3","solved","Fleet / Site Issues",null,"All robots are down"],["#270","2026-07-14","Arrow Electronics, Inc.","Sahil","L3","solved","Generic Error","freight100-2212","Did not complete precision undock"],["#271","2026-07-14","GARMIN INTERNATIONAL, INC.","Sahil","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#272","2026-07-14","GE APPLIANCES","Sahil","L1","solved","Navigation & Localization","freight100-2047","Robot Not Localized"],["#273","2026-07-14","Arrow Electronics, Inc.","Sahil","L3","solved","Generic Error","freight100-2418","UNLOAD RollerTop timed-out"],["#274","2026-07-14","Arrow Electronics, Inc.","Sahil","L3","solved","Generic Error","freight100-2244","UNLOAD RollerTop timed-out"],["#275","2026-07-14","Arrow Electronics, Inc.","Sahil","L3","solved","Generic Error","freight100-2244","UNLOAD RollerTop timed-out"],["#276","2026-07-14","Arrow Electronics, Inc.","Sahil","L3","solved","Generic Error","freight100-2244","UNLOAD RollerTop timed-out"],["#277","2026-07-14","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2244","UNLOAD RollerTop timed-out"],["#278","2026-07-14","GARMIN INTERNATIONAL, INC.","Sanath","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#279","2026-07-14","GARMIN INTERNATIONAL, INC.","Sanath","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#280","2026-07-14","Dynabrade","Vaishnav","L1","solved","Generic Error","freight100-1845","Could not escape from cart"],["#281","2026-07-14","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-2244","Did not complete precision undock"],["#282","2026-07-15","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#283","2026-07-15","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-2418","Did not complete precision undock"],["#284","2026-07-15","Stuller, Inc","Vaishnav","L3","in progress","Battery & Charging",null,"HMIShelf 2045"],["#285","2026-07-15","Inventive LLC","Vaishnav","L1","solved","Generic Error","freight100-1939","Forcing ABORT"],["#286","2026-07-15","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Generic Error","freight100-1311","Could not escape from cart"],["#287","2026-07-15","Inventive LLC","Vaishnav","L1","solved","Generic Error","freight100-1939","Forcing ABORT"],["#290","2026-07-15","Arrow Electronics, Inc.","Vaishnav","L3","solved","Generic Error","freight100-2302","Breaker error ENABLE_FAULT"],["#291","2026-07-15","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Battery & Charging","freight100-1292","Low Battery Warning 35%"],["#292","2026-07-15","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Battery & Charging","freight100-1292","Low Battery Warning 35%"],["#293","2026-07-15","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Generic Error","freight100-1311","Forcing ABORT"],["#294","2026-07-15","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Battery & Charging","freight100-1292","Low Battery Warning 35%"],["#295","2026-07-15","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Battery & Charging","freight100-1292","Low Battery Warning 35%"],["#296","2026-07-15","Arrow Electronics, Inc.","Sahil","L3","solved","Generic Error","freight100-2303","Did not complete precision undock"],["#297","2026-07-15","Arrow Electronics, Inc.","Sahil","L3","solved","Generic Error","freight100-2244","Did not complete precision undock"],["#298","2026-07-15","Arrow Electronics, Inc.","Sahil","L3","solved","Generic Error","freight100-2303","Breaker and table age fault"],["#299","2026-07-15","Arrow Electronics, Inc.","Sahil","L1","solved","Generic Error","freight100-2303","Breaker and table age fault"],["#300","2026-07-15","Inventive LLC","Sahil","L1","solved","Battery & Charging","freight100-2258","Low Battery Warning 35%"],["#305","2026-07-15","Inventive LLC","Sreekanth","L1","solved","Battery & Charging","freight100-1939","Low Battery Warning 35%"],["#306","2026-07-15","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#307","2026-07-15","Inventive LLC","Sreekanth","L1","solved","Battery & Charging","freight100-1939","Low Battery Warning 35%"],["#308","2026-07-15","Inventive LLC","Sreekanth","L1","solved","Software / Firmware","freight100-1939","Robot Not Localized"],["#309","2026-07-15","Inventive LLC","Sreekanth","L1","solved","Software / Firmware","freight100-1939","Low Battery Warning 26%"],["#310","2026-07-15","Inventive LLC","Sreekanth","L1","solved","Navigation & Localization","freight100-1939","Robot Not Localized"],["#311","2026-07-15","Inventive LLC","Sreekanth","L3","solved","Battery & Charging","freight100-1939","Low Battery Warning 23%"],["#312","2026-07-15","Zetes Ltd","Sreekanth","L3","in progress","Service Request",null,"Damaged Robot"],["#313","2026-07-15","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Navigation & Localization","freight100-1127","Robot Not Localized"],["#314","2026-07-15","Inventive LLC","Sreekanth","L1","solved","Navigation & Localization","freight100-1939","Robot Not Localized"],["#315","2026-07-15","Inventive LLC","Sreekanth","L1","solved","Navigation & Localization","freight100-2258","Robot Not Localized"],["#316","2026-07-15","Inventive LLC","Sreekanth","L1","solved","Battery & Charging","freight100-1939","Low Battery Warning 9%"],["#317","2026-07-15","Inventive LLC","Sreekanth","L1","solved","Battery & Charging","freight100-2258","Low Battery Warning 4%"],["#318","2026-07-15","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Battery & Charging","freight100-1127","Low Battery Warning 30%"],["#319","2026-07-15","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Battery & Charging","freight100-1127","Low Battery Warning 30%"],["#320","2026-07-15","DORMAN PRODUCTS","Sreekanth","L3","solved","Battery & Charging",null,"Battery and mis-localization issues"],["#321","2026-07-15","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2303","Did not complete precision undock"],["#322","2026-07-15","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2303","Did not complete precision undock"],["#323","2026-07-15","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#324","2026-07-15","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2302","Breaker error ENABLE_FAULT"],["#325","2026-07-15","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2302","Breaker error ENABLE_FAULT"],["#326","2026-07-15","Arrow Electronics, Inc.","Sreekanth","L3","solved","Generic Error","freight100-2302","Breaker error ENABLE_FAULT"],["#327","2026-07-15","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#328","2026-07-15","Inventive LLC","Sreekanth","L1","solved","Battery & Charging","freight100-1939","Low Battery Warning 35%"],["#329","2026-07-15","Inventive LLC","Sreekanth","L1","solved","Generic Error","freight100-2063","Forcing ABORT"],["#330","2026-07-15","Inventive LLC","Sreekanth","L1","solved","Generic Error","freight100-2063","Forcing ABORT"],["#331","2026-07-15","GE APPLIANCES","Sanath","L1","solved","Navigation & Localization","freight100-2047","Robot Not Localized"],["#332","2026-07-16","GE APPLIANCES","Sanath","L1","solved","Navigation & Localization","freight100-2047","Robot Not Localized"],["#388","2026-07-20","VWR International","Sanath","L3","pending","Parts & Logistics",null,"Zebra Robot parts request"],["#392","2026-07-20","GARMIN INTERNATIONAL, INC.","Sahil","L3","solved","Connectivity",null,"1292 Wifi Card Check"],["#393","2026-07-20","Arrow Electronics, Inc.","Sahil","L3","solved","Generic Error","freight100-2620","LOAD RollerTop action failed"],["#398","2026-07-21","Arrow Electronics, Inc.","Vaishnav","L3","pending","Parts & Logistics",null,"HMI Screens not working for 2 robots"],["#399","2026-07-21","Arrow Electronics, Inc.","Vaishnav","L3","pending","Battery & Charging",null,"Charge docks Maintenance"],["#400","2026-07-21","Arrow Electronics, Inc.","Vaishnav","L3","pending","Parts & Logistics","freight100-1924","freight100-1924 need new front skin"],["#414","2026-07-21","Iveco","Sanath","L3","pending","Others","freight100-1692","Freight100-1692 failed to dock"],["#418","2026-07-22","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#419","2026-07-22","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#420","2026-07-22","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#421","2026-07-22","Inventive LLC","Sreekanth","L1","solved","Battery & Charging","freight100-2063","Low Battery Warning 35%"],["#422","2026-07-22","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#429","2026-07-22","Arrow Electronics, Inc.","Sahil","L3","solved","Generic Error","freight100-2418","Did not complete precision undock"],["#430","2026-07-22","Arrow Electronics, Inc.","Sahil","L1","solved","Generic Error","freight100-2418","Did not complete precision undock"],["#431","2026-07-22","Arrow Electronics, Inc.","Sahil","L1","solved","Generic Error","freight100-2418","Did not complete precision undock"],["#433","2026-07-22","Arrow Electronics, Inc.","Sreekanth","L1","solved","Generic Error","freight100-2418","Did not complete precision undock"],["#434","2026-07-22","Arrow Electronics, Inc.","Sreekanth","L1","solved","Generic Error","freight100-2418","Did not complete precision undock"],["#435","2026-07-22","Arrow Electronics, Inc.","Sreekanth","L1","solved","Generic Error","freight100-2418","Did not complete precision undock"],["#436","2026-07-22","Arrow Electronics, Inc.","Sahil","L1","solved","Generic Error","freight100-2418","Did not complete precision undock"],["#437","2026-07-22","Arrow Electronics, Inc.","Sahil","L1","solved","Generic Error","freight100-2418","Did not complete precision undock"],["#438","2026-07-22","Arrow Electronics, Inc.","Sahil","L1","solved","Generic Error","freight100-2418","Did not complete precision undock"],["#478","2026-07-23","GARMIN INTERNATIONAL, INC.","Sanath","L1","solved","Generic Error","freight100-1292","Could not escape from cart"],["#479","2026-07-23","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#480","2026-07-23","GARMIN INTERNATIONAL, INC.","Sahil","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#492","2026-07-24","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#493","2026-07-24","Inventive LLC","Vaishnav","L1","solved","Battery & Charging","freight100-2063","Low Battery Warning 35%"],["#494","2026-07-24","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#502","2026-07-24","Sequence Robotics SAS","Sreekanth","L3","in progress","Connectivity","freight100-1930","Weak Wi-Fi since delivery"],["#503","2026-07-24","Lexter Italia Srl","Sahil","L3","in progress","Robot Hardware","AMR-2177","AMR 2177 accident"],["#505","2026-07-24","VWR International","Sahil","L3","solved","Generic Error","freight100-1766","Motor error MOTOR ALIGNMENT OFFSET"],["#514","2026-07-24","GARMIN INTERNATIONAL, INC.","Sahil","L3","in progress","Robot Hardware",null,"1201 Failed to pick up"],["#519","2026-07-25","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Generic Error","freight100-1311","Forcing ABORT"],["#521","2026-07-25","Apple Inc","Vaishnav","L3","in progress","Parts & Logistics",null,"Robot impact with forklift"],["#522","2026-07-26","Inventive LLC","Vaishnav","L3","solved","Battery & Charging","freight100-2258","Low Battery Warning 35%"],["#523","2026-07-26","GARMIN INTERNATIONAL, INC.","Sreekanth","L1","solved","Battery & Charging",null,"Low Battery Alert freight100-1311"],["#527","2026-07-27","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Battery & Charging","freight100-1311","Low Battery Warning 35%"],["#531","2026-07-27","GARMIN INTERNATIONAL, INC.","Sanath","L1","solved","Battery & Charging","freight100-1195","Low Battery Warning 35%"],["#534","2026-07-27","ABB","Sahil","L3","pending","Mapping",null,"Help With Transitioning to New Map"],["#548","2026-07-28","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#549","2026-07-28","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#558","2026-07-29","GARMIN INTERNATIONAL, INC.","Vaishnav","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#562","2026-07-29","GARMIN INTERNATIONAL, INC.","Sahil","L1","solved","Generic Error","freight100-1292","Forcing ABORT"],["#566","2026-07-29","Stoops Indy","Sahil","L3","pending","Software / Firmware",null,"Fleet Status"],["#579","2026-07-30","Inventive LLC","Sanath","L1","solved","Navigation & Localization","freight100-2258","Robot Not Localized"]];

const SD = {
  summary:{ total:661, resolved:628, pending:20, inProgress:13, l1:481, l3:147, customer:143, autoAlert:519 },
  monthly:[
    {month:"June",   total:53,  resolved:50,  pending:1,  inProgress:2,  rate:94.3},
    {month:"July",   total:492, resolved:473, pending:11, inProgress:8,  rate:96.1},
    {month:"August", total:116, resolved:105, pending:8,  inProgress:3,  rate:90.5},
  ],
  weekly:{
    june:[{wk:"W4 (22-28)",total:20,resolved:19,pending:0,inProgress:1},{wk:"W5 (29-30)",total:33,resolved:31,pending:1,inProgress:1}],
    july:[{wk:"W1 (1-5)",total:27,resolved:26,pending:0,inProgress:1},{wk:"W2 (6-12)",total:105,resolved:104,pending:0,inProgress:1},{wk:"W3 (13-19)",total:135,resolved:133,pending:0,inProgress:2},{wk:"W4 (20-26)",total:139,resolved:130,pending:5,inProgress:4},{wk:"W5 (27-31)",total:86,resolved:80,pending:6,inProgress:0}],
    august:[{wk:"W1 (1-2)",total:14,resolved:14,pending:0,inProgress:0},{wk:"W2 (3-9)",total:102,resolved:91,pending:8,inProgress:3}],
  },
  daily:{
    june:  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,6,2,6,2,1,1,20,13],
    july:  [10,8,9,0,0,9,15,25,19,9,23,5,10,19,50,23,24,8,1,7,23,59,15,27,3,5,21,10,21,16,18],
    august:[3,11,23,24,37,13,5],
  },
  // Shifts: rotational — no agent name, just shift slot + time
  shifts:[
    {label:"Shift 1", time:"7AM-4PM",  tickets:142, pct:21.5, color:D.p},
    {label:"Shift 2", time:"3PM-12AM", tickets:334, pct:50.5, color:D.ok},
    {label:"Shift 3", time:"11PM-8AM", tickets:185, pct:28.0, color:D.wn},
  ],
  // Agents: name only, no shift-time in role field
  agents:[
    {name:"Sahil",     total:253, l1:196, l3:46, june:25, july:164, aug:64,  color:D.p},
    {name:"Sreekanth", total:163, l1:114, l3:47, june:6,  july:143, aug:14,  color:D.ok},
    {name:"Vaishnav",  total:162, l1:107, l3:42, june:11, july:120, aug:31,  color:D.wn},
    {name:"Sanath",    total:83,  l1:64,  l3:12, june:11, july:65,  aug:7,   color:D.er},
  ],
};

const CATS=[
  {type:"Generic Error",            count:327, pct:49.5},
  {type:"Battery & Charging",       count:118, pct:17.9},
  {type:"Navigation & Localization",count:79,  pct:11.9},
  {type:"Invalid Tickets",          count:25,  pct:3.8},
  {type:"Robot Hardware",           count:25,  pct:3.8},
  {type:"Parts & Logistics",        count:17,  pct:2.6},
  {type:"Test",                     count:16,  pct:2.4},
  {type:"Information Request",      count:13,  pct:2.0},
  {type:"Software / Firmware",      count:12,  pct:1.8},
  {type:"Mapping",                  count:6,   pct:0.9},
  {type:"Service Request",          count:6,   pct:0.9},
  {type:"Others",                   count:6,   pct:0.9},
  {type:"Connectivity",             count:5,   pct:0.8},
  {type:"Fleet / Site Issues",      count:3,   pct:0.5},
  {type:"Sensors",                  count:3,   pct:0.5},
];

const MTD = {total:116, resolved:105, unresolved:11, rate:90.5};
// Rolling day snapshots — replace with live values once the sheet is connected (see fetchLiveRows)
const TODAY_YDAY = {
  yesterday: {label:"Aug 7", total:5, resolved:4, pending:1, inProgress:0},
  today:     {label:"Aug 8", total:0, resolved:0, pending:0, inProgress:0, live:true},
};

// ─── ANOMALY ENGINE ──────────────────────────────────────────────────────────
function buildAnomalies(raw) {
  const results = [];
  const rmap = {};
  for (const r of raw) {
    const robot=r[7], ty=r[6];
    if(!robot) continue;
    if(!rmap[robot]) rmap[robot]={id:robot,cust:r[2],tot:0,types:{}};
    rmap[robot].tot++; rmap[robot].types[ty]=(rmap[robot].types[ty]||0)+1;
  }
  for (const rb of Object.values(rmap).sort((a,b)=>b.tot-a.tot)) {
    if(rb.tot>=8){
      const top=Object.entries(rb.types).sort((a,b)=>b[1]-a[1])[0];
      results.push({id:`robot-${rb.id}`,type:"robot",lvl:rb.tot>=15?"critical":"warning",title:`${rb.id} — ${rb.tot} tickets`,desc:`Top issue: ${top[0]} (x${top[1]}). Systemic fault pattern.`,count:rb.tot,cust:rb.cust,robot:rb.id});
    }
  }
  const stale=raw.filter(r=>(r[5]==="pending"||r[5]==="in progress")&&r[1]&&new Date(r[1])<new Date("2026-07-20"));
  if(stale.length) results.push({id:"stale-tickets",type:"stale",lvl:"critical",title:`${stale.length} tickets stale 7+ days`,desc:"No resolution and approaching SLA breach territory.",count:stale.length,tix:stale.slice(0,5)});
  const allDaily=[...SD.daily.june,...SD.daily.july,...SD.daily.august];
  const window7=7;
  for(let i=window7;i<allDaily.length;i++){
    const avg=allDaily.slice(i-window7,i).reduce((s,v)=>s+v,0)/window7;
    if(allDaily[i]>0&&avg>0&&allDaily[i]>avg*2.2&&allDaily[i]>15){
      const day=i<30?`Jun ${i+1}`:i<61?`Jul ${i-29}`:`Aug ${i-60}`;
      results.push({id:`spike-day-${i}`,type:"spike",lvl:"warning",title:`Volume spike on ${day}`,desc:`${allDaily[i]} tickets vs ${avg.toFixed(0)}-day avg of ${Math.round(avg)}. Unusually high activity.`,count:allDaily[i]});
      break;
    }
  }
  return results;
}

function computeFleet(raw) {
  const cmap={}, rmap={};
  let tot=0,l1c=0,l3c=0,solv=0,pend=0,opn=0;
  for (const r of raw) {
    const lvl=r[4], st=r[5], ty=r[6], robot=r[7], cust=r[2];
    tot++; if(lvl==="L1") l1c++; else l3c++;
    if(st==="solved"||st==="closed") solv++; else if(st==="pending") pend++; else opn++;
    if(!cmap[cust]) cmap[cust]={name:cust,tot:0,l1:0,l3:0,solv:0,pend:0,opn:0,types:{},robots:new Set(),tix:[]};
    const cc=cmap[cust];
    cc.tot++; if(lvl==="L1") cc.l1++; else cc.l3++;
    if(st==="solved"||st==="closed") cc.solv++; else if(st==="pending") cc.pend++; else cc.opn++;
    cc.types[ty]=(cc.types[ty]||0)+1; if(robot) cc.robots.add(robot); cc.tix.push(r);
    if(robot){
      if(!rmap[robot]) rmap[robot]={id:robot,cust,tot:0,types:{},tix:[]};
      const rb=rmap[robot]; rb.tot++; rb.types[ty]=(rb.types[ty]||0)+1; rb.tix.push(r);
    }
  }
  for(const cc of Object.values(cmap)){cc.robotCount=cc.robots.size; cc.robots=[...cc.robots];}
  const custArr=Object.values(cmap).sort((a,b)=>b.tot-a.tot);
  const robArr=Object.values(rmap).sort((a,b)=>b.tot-a.tot);
  const unsolved=raw.filter(r=>r[5]==="pending"||r[5]==="in progress");
  const anomalies=buildAnomalies(raw);
  return {tot,l1c,l3c,solv,pend,opn,custArr,robArr,cmap,rmap,unsolved,anomalies};
}

// ─── SHARED COMPONENTS ───────────────────────────────────────────────────────
function Kpi({label,value,sub,border,alert,small}){
  return(
    <div style={{background:D.card,borderRadius:D.r,boxShadow:D.sh1,padding:small?"12px 14px":"16px 18px",borderLeft:`3px solid ${border||D.p}`,position:"relative"}}>
      {alert&&<div style={{position:"absolute",top:7,right:7,width:6,height:6,borderRadius:"50%",background:D.er}}/>}
      <div style={{fontSize:small?20:26,fontWeight:800,color:D.t1,lineHeight:1}}>{value}</div>
      <div style={{fontSize:10,color:D.t3,marginTop:4,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:500}}>{label}</div>
      {sub&&<div style={{fontSize:10,color:border||D.p,marginTop:3,fontWeight:600}}>{sub}</div>}
    </div>
  );
}

function Card({title,sub,children,noPad}){
  return(
    <div style={{background:D.card,borderRadius:D.r,boxShadow:D.sh1,overflow:"hidden",border:`1px solid ${D.div}`}}>
      <div style={{padding:"12px 16px",borderBottom:`1px solid ${D.div}`,background:"#FAFBFF"}}>
        <div style={{fontSize:12,fontWeight:700,color:D.t1}}>{title}</div>
        {sub&&<div style={{fontSize:10,color:D.t3,marginTop:2}}>{sub}</div>}
      </div>
      {noPad?children:<div style={{padding:14}}>{children}</div>}
    </div>
  );
}

function Tag({type,sm}){
  const c=CC[type]||"#64748B";
  return <span style={{background:c+"15",color:c,fontSize:sm?9:10,fontWeight:600,padding:sm?"1px 5px":"2px 8px",borderRadius:3,display:"inline-block",maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",border:`1px solid ${c}25`}}>{type}</span>;
}

function RID({id}){
  if(!id) return <span style={{color:D.t3,fontSize:10}}>-</span>;
  return <span style={{fontFamily:D.fm,fontSize:9,color:D.p,background:D.pLt,padding:"1px 6px",borderRadius:D.rs,border:"1px solid #BFDBFE"}}>{id}</span>;
}

function Bar2({value,max,color,h=6}){
  return(
    <div style={{background:D.div,borderRadius:99,height:h,overflow:"hidden",flexGrow:1}}>
      <div style={{width:`${Math.min(100,Math.round(value/max*100))}%`,height:"100%",background:color,borderRadius:99}}/>
    </div>
  );
}

function CTip({active,payload,label}){
  if(!active||!payload||!payload.length) return null;
  return(
    <div style={{background:D.card,border:`1px solid ${D.bd}`,borderRadius:D.r,padding:"8px 12px",boxShadow:D.sh2,fontSize:11,fontFamily:D.f}}>
      <div style={{color:D.t3,marginBottom:4,fontWeight:500}}>{label}</div>
      {payload.map((p,i)=><div key={i} style={{fontWeight:700,color:p.color||D.p}}>{p.name}: {p.value}</div>)}
    </div>
  );
}

// Unsolved-specific table: no Owner, no Status; has editable Comment (supervisor only)
function UnsolvedTable({rows}){
  const [comments, setComments] = useState({});
  const [editing, setEditing] = useState(null);
  const inputRef = useRef(null);

  const handleEdit = (id) => {
    setEditing(id);
    setTimeout(()=>{ if(inputRef.current) inputRef.current.focus(); },30);
  };

  const handleChange = (id, val) => {
    const words = val.trim().split(/\s+/).filter(Boolean);
    if(words.length<=5) setComments(prev=>({...prev,[id]:val}));
    else setComments(prev=>({...prev,[id]:words.slice(0,5).join(" ")}));
  };

  const handleBlur = () => { setEditing(null); };

  return(
    <div style={{overflowX:"auto",maxHeight:440,overflowY:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:D.f}}>
        <thead style={{position:"sticky",top:0,background:"#FAFBFF",zIndex:1}}>
          <tr>{["Ticket","Date","Customer","Type","Issue","Lvl","Note (≤5 words)"].map(h=>(
            <th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:10,fontWeight:700,color:D.t3,textTransform:"uppercase",letterSpacing:"0.06em",borderBottom:`2px solid ${D.div}`,whiteSpace:"nowrap"}}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r,i)=>{
            const id=r[FX.ID];
            const isEdit=editing===id;
            return(
              <tr key={i} style={{borderBottom:`1px solid ${D.div}`}}
                onMouseEnter={e=>e.currentTarget.style.background=D.page}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <td style={{padding:"7px 10px",fontFamily:D.fm,fontSize:10,color:D.p,fontWeight:500,whiteSpace:"nowrap"}}>{id}</td>
                <td style={{padding:"7px 10px",fontSize:10,color:D.t3,whiteSpace:"nowrap"}}>{r[FX.DT]}</td>
                <td style={{padding:"7px 10px",fontSize:11,color:D.t2,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r[FX.CS]}</td>
                <td style={{padding:"7px 10px"}}><Tag type={r[FX.TY]} sm/></td>
                <td style={{padding:"7px 10px",fontSize:11,color:D.t1,maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r[FX.IS]}</td>
                <td style={{padding:"7px 10px",fontSize:10,fontWeight:700,color:r[FX.LV]==="L3"?D.wn:D.t3}}>{r[FX.LV]}</td>
                <td style={{padding:"5px 8px",minWidth:140}}>
                  {isEdit?(
                    <input
                      ref={inputRef}
                      value={comments[id]||""}
                      onChange={e=>handleChange(id,e.target.value)}
                      onBlur={handleBlur}
                      placeholder="Add note..."
                      style={{width:"100%",border:`1px solid ${D.p}`,borderRadius:D.rs,padding:"3px 7px",fontSize:11,fontFamily:D.f,outline:"none",color:D.t1,background:"white",boxSizing:"border-box"}}
                    />
                  ):(
                    <div
                      onClick={()=>handleEdit(id)}
                      title="Click to edit (supervisor)"
                      style={{cursor:"text",minHeight:24,padding:"3px 7px",borderRadius:D.rs,border:`1px solid transparent`,fontSize:11,color:comments[id]?D.t1:D.t3,fontStyle:comments[id]?"normal":"italic",transition:"border 0.1s"}}
                      onMouseEnter={e=>e.currentTarget.style.borderColor=D.bd}
                      onMouseLeave={e=>e.currentTarget.style.borderColor="transparent"}
                    >
                      {comments[id]||"Add note..."}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Standard read-only table for customers/robots
function TicketTable({rows,maxH}){
  return(
    <div style={{overflowX:"auto",maxHeight:maxH||320,overflowY:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:D.f}}>
        <thead style={{position:"sticky",top:0,background:"#FAFBFF",zIndex:1}}>
          <tr>{["Ticket","Date","Customer","Owner","Type","Issue","Status","Lvl"].map(h=>(
            <th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:10,fontWeight:700,color:D.t3,textTransform:"uppercase",letterSpacing:"0.06em",borderBottom:`2px solid ${D.div}`,whiteSpace:"nowrap"}}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r,i)=>{
            const stMap={solved:{c:D.ok,l:"Solved"},closed:{c:D.ok,l:"Closed"},pending:{c:D.wn,l:"Pending"},"in progress":{c:D.p,l:"In Progress"}};
            const st=stMap[(r[FX.ST]||"").toLowerCase()]||{c:D.t3,l:r[FX.ST]};
            return(
              <tr key={i} style={{borderBottom:`1px solid ${D.div}`}}
                onMouseEnter={e=>e.currentTarget.style.background=D.page}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <td style={{padding:"7px 10px",fontFamily:D.fm,fontSize:10,color:D.p,fontWeight:500,whiteSpace:"nowrap"}}>{r[FX.ID]}</td>
                <td style={{padding:"7px 10px",fontSize:10,color:D.t3,whiteSpace:"nowrap"}}>{r[FX.DT]}</td>
                <td style={{padding:"7px 10px",fontSize:11,color:D.t2,maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r[FX.CS]}</td>
                <td style={{padding:"7px 10px",fontSize:11,color:D.t2,fontWeight:500}}>{r[FX.OW]}</td>
                <td style={{padding:"7px 10px"}}><Tag type={r[FX.TY]} sm/></td>
                <td style={{padding:"7px 10px",fontSize:11,color:D.t1,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r[FX.IS]}</td>
                <td style={{padding:"7px 10px"}}><span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,fontWeight:600,color:st.c}}><span style={{width:5,height:5,borderRadius:"50%",background:st.c,flexShrink:0}}/>{st.l}</span></td>
                <td style={{padding:"7px 10px",fontSize:10,fontWeight:700,color:r[FX.LV]==="L3"?D.wn:D.t3}}>{r[FX.LV]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── PAGE: OVERVIEW ──────────────────────────────────────────────────────────
function Overview({ summary, monthly, daily, shifts, agents, cats }) {
  const sm = {
    total:        summary?.total        || 0,
    resolved:     summary?.resolved     || 0,
    pending:      summary?.pending      || 0,
    inProgress:   summary?.inProgress   || 0,
    l1:           summary?.l1           || 0,
    l3:           summary?.l3           || 0,
    autoAlert:    summary?.autoAlert    || 0,
    customerTicket: summary?.customerTicket || 0,
  };
  const unresolved = sm.pending + sm.inProgress;
  const dailyAll = (daily || []).filter(d => d.v > 0);
  const splitPie = [
    { name: "Auto-Alert", value: sm.autoAlert },
    { name: "Customer",   value: sm.customerTicket },
  ];
  const resPie = [
    { name: "Resolved",   value: sm.resolved   },
    { name: "Unresolved", value: unresolved     },
  ].filter(x => x.value > 0);
 
  // MTD = current month row
  const curMonth = new Date().toLocaleString("en-US", { month: "long" });
  const mtd = (monthly || []).find(m => m.month === curMonth) || {};
  const MTD = {
    total:      mtd.total      || 0,
    resolved:   mtd.resolved   || 0,
    unresolved: (mtd.pending||0) + (mtd.inProgress||0),
    rate:       mtd.rate       || 0,
  };
 
  // Yesterday / Today
  const fmt = d => d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
  const now  = new Date();
  const yday = new Date(now); yday.setDate(yday.getDate()-1);
  const todayRow = (daily||[]).find(d=>d.label===fmt(now))  || {v:0,resolved:0,pending:0,inProgress:0};
  const ydayRow  = (daily||[]).find(d=>d.label===fmt(yday)) || {v:0,resolved:0,pending:0,inProgress:0};
  const TODAY_YDAY = {
    yesterday: {label:fmt(yday), total:ydayRow.v,  resolved:ydayRow.resolved,  pending:ydayRow.pending,  inProgress:ydayRow.inProgress},
    today:     {label:fmt(now),  total:todayRow.v, resolved:todayRow.resolved, pending:todayRow.pending, inProgress:todayRow.inProgress, live:true},
  };
 
  const CATS = cats || [];
  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* Row 1: Solved */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
        <Kpi label="Total Tickets"  value={sm.total}    sub="Jun-Aug 2026"          border={D.p}/>
        <Kpi label="Solved Tickets" value={sm.resolved} sub="95% resolve rate"      border={D.ok}/>
        <Kpi label="Solved - L1"    value={sm.l1}       sub="Self-served"           border={D.ok}/>
        <Kpi label="Solved - L3"    value={sm.l3}       sub="Escalated & closed"   border={D.wn}/>
      </div>
      {/* Row 2: Unresolved */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
        <Kpi label="Unresolved"     value={unresolved}  sub="Pending + In Progress" border={D.er} alert={unresolved>15}/>
        <Kpi label="Unresolved - L1" value={0}          sub="All L1 resolved"       border={D.t3}/>
        <Kpi label="Unresolved - L3" value={unresolved} sub="Awaiting resolution"   border={D.er}/>
        <Kpi label="Auto-Alerts"    value={sm.autoAlert} sub={`${Math.round(sm.autoAlert/sm.total*100)}% of total`} border={D.t3}/>
      </div>

      {/* MTD — below the numbers */}
      <div style={{background:"linear-gradient(135deg,#1E3A8A 0%,#1D4ED8 100%)",borderRadius:D.r,padding:"14px 20px",display:"flex",gap:20,alignItems:"center"}}>
        <div style={{borderRight:"1px solid rgba(255,255,255,0.18)",paddingRight:20}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.65)",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.1em"}}>Month-to-Date · August 2026</div>
          <div style={{fontSize:26,fontWeight:800,color:"white",lineHeight:1,marginTop:3}}>{MTD.total} <span style={{fontSize:12,fontWeight:400,opacity:0.75}}>tickets</span></div>
        </div>
        {[["Resolved",MTD.resolved],["Unresolved",MTD.unresolved],["Resolve Rate",MTD.rate+"%"]].map(([l,v])=>(
          <div key={l} style={{background:"rgba(255,255,255,0.1)",borderRadius:D.rs,padding:"8px 16px",textAlign:"center"}}>
            <div style={{fontSize:18,fontWeight:800,color:"white"}}>{v}</div>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.65)",fontWeight:500,marginTop:2}}>{l}</div>
          </div>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:14,paddingLeft:14,borderLeft:"1px solid rgba(255,255,255,0.18)"}}>
          {[["Yesterday",TODAY_YDAY.yesterday],["Today",TODAY_YDAY.today]].map(([l,d])=>(
            <div key={l} style={{textAlign:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                <span style={{fontSize:9,color:"rgba(255,255,255,0.6)",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em"}}>{l}</span>
                {d.live&&<span style={{width:5,height:5,borderRadius:"50%",background:"#4ADE80",display:"inline-block"}}/>}
              </div>
              <div style={{fontSize:15,fontWeight:800,color:"white",marginTop:1}}>{d.total}</div>
              <div style={{display:"flex",gap:6,justifyContent:"center",marginTop:2}}>
                <span style={{fontSize:9,color:"#86EFAC"}}>{d.resolved}✓</span>
                {d.pending>0&&<span style={{fontSize:9,color:"#FDE68A"}}>{d.pending}pend</span>}
                {d.inProgress>0&&<span style={{fontSize:9,color:"#BFDBFE"}}>{d.inProgress}prog</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Trend + Origin */}
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:14}}>
        <Card title="Daily Ticket Volume" sub="Jun-Aug 2026 · all agents">
          <ResponsiveContainer width="100%" height={190}>
            <AreaChart data={dailyAll} margin={{left:-20,right:6,top:4,bottom:0}}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={D.p} stopOpacity={0.12}/>
                  <stop offset="95%" stopColor={D.p} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={D.div} vertical={false}/>
              <XAxis dataKey="label" tick={{fontSize:9,fill:D.t3}} interval={6}/>
              <YAxis tick={{fontSize:9,fill:D.t3}}/>
              <Tooltip content={<CTip/>}/>
              <Area type="monotone" dataKey="v" name="Tickets" stroke={D.p} strokeWidth={2} fill="url(#g1)" dot={false}/>
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Ticket Origin">
          <ResponsiveContainer width="100%" height={110}>
            <PieChart>
              <Pie data={splitPie} dataKey="value" cx="50%" cy="50%" innerRadius={32} outerRadius={50} paddingAngle={3}>
                <Cell fill={D.p}/><Cell fill={D.a}/>
              </Pie>
              <Tooltip/>
            </PieChart>
          </ResponsiveContainer>
          <div style={{display:"flex",gap:12,justifyContent:"center",marginTop:6}}>
            {splitPie.map((s,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:D.t2}}>
                <div style={{width:8,height:8,borderRadius:2,background:i===0?D.p:D.a}}/>
                <span>{s.name}</span>
                <strong style={{color:D.t1}}>{s.value}</strong>
              </div>
            ))}
          </div>
          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${D.div}`}}>
            <div style={{fontSize:10,color:D.t3,fontWeight:600,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Resolved vs Unresolved</div>
            {resPie.map((p,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <div style={{width:7,height:7,borderRadius:2,background:[D.ok,D.er][i],flexShrink:0}}/>
                <span style={{fontSize:11,color:D.t2,flex:1}}>{p.name}</span>
                <span style={{fontSize:11,fontWeight:700,color:D.t1}}>{p.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Monthly + Shift */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
         <Card title="Monthly Volume">
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={monthly||[]} margin={{left:-20,right:6,top:4,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke={D.div} vertical={false}/>
              <XAxis dataKey="month" tick={{fontSize:10,fill:D.t3}}/>
              <YAxis tick={{fontSize:9,fill:D.t3}}/>
              <Tooltip content={<CTip/>}/>
              <Bar dataKey="total"    name="Total"    fill={D.pLt} stroke={D.p} strokeWidth={1} radius={[4,4,0,0]}/>
              <Bar dataKey="resolved" name="Resolved" fill={D.ok}  radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Shift Load">
          <div style={{display:"flex",flexDirection:"column",gap:10,padding:"2px 0"}}>
            {(shifts||[]).map(sh=>(
              <div key={sh.label}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:12,fontWeight:600,color:D.t1}}>{sh.label} <span style={{fontSize:10,color:D.t3,fontWeight:400}}>{sh.time}</span></span>
                  <span style={{fontSize:12,fontWeight:700,color:sh.color}}>{sh.tickets} <span style={{fontSize:10,color:D.t3}}>{sh.pct}%</span></span>
                </div>
                <Bar2 value={sh.tickets} max={sm.total||1} color={sh.color} h={7}/>
              </div>
            ))}
          </div>
          <div style={{marginTop:12,paddingTop:10,borderTop:`1px solid ${D.div}`}}>
            <div style={{fontSize:10,color:D.t3,fontWeight:600,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>L1 vs L3 per Agent</div>
            <ResponsiveContainer width="100%" height={55}>
              <BarChart data={agents||[]} layout="vertical" margin={{left:0,right:0,top:0,bottom:0}}>
                <XAxis type="number" hide/>
                <YAxis type="category" dataKey="name" tick={{fontSize:10,fill:D.t2}} width={60}/>
                <Bar dataKey="l1" name="L1" stackId="a" fill={D.p}/>
                <Bar dataKey="l3" name="L3" stackId="a" fill={D.a} radius={[0,3,3,0]}/>
                <Tooltip content={<CTip/>}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Category Breakdown */}
       <Card title="Issue Category Breakdown" sub={`${sm.total} tickets · ${summary?.dateFrom||""} – ${summary?.dateTo||""}`}>
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {CATS.map(cat=>(
            <div key={cat.type} style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{display:"flex",alignItems:"center",gap:6,width:220,flexShrink:0}}>
                <div style={{width:7,height:7,borderRadius:2,background:CC[cat.type]||"#94A3B8",flexShrink:0}}/>
                <span style={{fontSize:11,color:D.t2,fontWeight:cat.count>50?600:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cat.type}</span>
              </div>
              <Bar2 value={cat.count} max={CATS[0].count} color={CC[cat.type]||"#94A3B8"} h={5}/>
              <span style={{fontSize:12,fontWeight:700,color:D.t1,width:30,textAlign:"right"}}>{cat.count}</span>
              <span style={{fontSize:10,color:D.t3,width:36,textAlign:"right"}}>{cat.pct}%</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── PAGE: SHIFT SUMMARY ─────────────────────────────────────────────────────
function ShiftSummary({ monthly, daily: dailyProp, agents, summary }) {
  const [tab, setTab] = useState("monthly");
  const [mo, setMo] = useState("july");
  const TS = (a) => ({padding:"6px 14px",borderRadius:D.rs,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:D.f,background:a?D.p:"transparent",color:a?D.sA:D.t3});
 
  // Build month→day lookup from live daily array
  const moMap = {"january":"jan","february":"feb","march":"mar","april":"apr","may":"may",
    "june":"jun","july":"jul","august":"aug","september":"sep","october":"oct","november":"nov","december":"dec"};
  const mo3 = moMap[mo] || mo.substring(0,3);
  const dailyData = (dailyProp||[])
    .filter(d => d.label.toLowerCase().startsWith(mo3))
    .map(d => ({day: parseInt(d.label.split(" ")[1]), tickets: d.v,
      resolved: d.resolved||0, pending: d.pending||0, inProgress: d.inProgress||0}))
    .sort((a,b) => a.day - b.day);
 
  // Compute weekly from daily
  const weeklyData = (() => {
    if (!dailyData.length) return [];
    const weeks = []; let wk = []; let wkStart = dailyData[0].day;
    const moIdx = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(mo3);
    dailyData.forEach((d,i) => {
      wk.push(d);
      const dow = new Date(2026, moIdx, d.day).getDay();
      if (dow === 0 || i === dailyData.length - 1) {
        const tot = wk.reduce((s,x)=>s+x.tickets,0);
        const res = wk.reduce((s,x)=>s+x.resolved,0);
        weeks.push({
          wk: `W${weeks.length+1} (${wkStart}-${d.day})`,
          total: tot, resolved: res,
          pending: wk.reduce((s,x)=>s+x.pending,0),
          inProgress: wk.reduce((s,x)=>s+x.inProgress,0),
        });
        wk = []; wkStart = dailyData[i+1]?.day;
      }
    });
    return weeks;
  })();
 
  const agentMonthly = (monthly||[]).map(m => {
    const row = {month: m.month};
    (agents||[]).forEach(a => {
      const k = m.month.substring(0,3).toLowerCase();
      row[a.name] = a[k] || 0;
    });
    return row;
  });
  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",gap:4,background:D.div,padding:3,borderRadius:D.r,width:"fit-content"}}>
        {[["daily","Daily"],["weekly","Weekly"],["monthly","Monthly"],["yearly","Yearly"]].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={TS(tab===k)}>{l}</button>
        ))}
      </div>
      {(tab==="daily"||tab==="weekly")&&(
        <div style={{display:"flex",gap:6}}>
          {[["june","June"],["july","July"],["august","August"]].map(([k,l])=>(
            <button key={k} onClick={()=>setMo(k)} style={{padding:"4px 12px",borderRadius:D.rs,border:`1px solid ${mo===k?D.p:D.bd}`,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:D.f,background:mo===k?D.pLt:"white",color:mo===k?D.p:D.t2}}>{l}</button>
          ))}
        </div>
      )}
      {tab==="daily"&&(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <Card title={`Daily Volume - ${mo.charAt(0).toUpperCase()+mo.slice(1)} 2026`}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dailyData} margin={{left:-20,right:6,top:4,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke={D.div} vertical={false}/>
                <XAxis dataKey="day" tick={{fontSize:9,fill:D.t3}}/>
                <YAxis tick={{fontSize:9,fill:D.t3}}/>
                <Tooltip content={<CTip/>}/>
                <Bar dataKey="tickets" name="Tickets" radius={[3,3,0,0]}>
                  {dailyData.map((d,i)=><Cell key={i} fill={d.tickets>30?D.er:d.tickets>20?D.wn:D.p}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
            {SD.agents.map(a=>{
              const v=a[mo.substring(0,3)]||0;
              return(
                <div key={a.name} style={{textAlign:"center",padding:"14px 10px",background:D.page,borderRadius:D.r,border:`1px solid ${D.div}`}}>
                  <div style={{width:30,height:30,borderRadius:"50%",background:a.color,margin:"0 auto 8px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:"white"}}>{a.name[0]}</div>
                  <div style={{fontSize:22,fontWeight:800,color:a.color}}>{v}</div>
                  <div style={{fontSize:11,fontWeight:600,color:D.t1,marginTop:2}}>{a.name}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {tab==="weekly"&&(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <Card title={`Weekly Volume - ${mo.charAt(0).toUpperCase()+mo.slice(1)} 2026`}>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={weeklyData} margin={{left:-20,right:6,top:4,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke={D.div} vertical={false}/>
                <XAxis dataKey="wk" tick={{fontSize:9,fill:D.t3}}/>
                <YAxis tick={{fontSize:9,fill:D.t3}}/>
                <Tooltip content={<CTip/>}/>
                <Bar dataKey="total"    name="Total"    fill={D.pLt} stroke={D.p} strokeWidth={1} radius={[4,4,0,0]}/>
                <Bar dataKey="resolved" name="Resolved" fill={D.ok}  radius={[4,4,0,0]}/>
                <Bar dataKey="pending"  name="Pending"  fill={D.wn}  radius={[4,4,0,0]}/>
                <Legend wrapperStyle={{fontSize:11}}/>
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card title="Weekly Detail" noPad>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:D.f}}>
              <thead><tr style={{background:"#FAFBFF"}}>{["Week","Total","Resolved","Pending","In Prog","Rate %"].map(h=><th key={h} style={{padding:"9px 12px",textAlign:h==="Week"?"left":"right",fontSize:10,fontWeight:700,color:D.t3,textTransform:"uppercase",letterSpacing:"0.06em",borderBottom:`1px solid ${D.div}`}}>{h}</th>)}</tr></thead>
              <tbody>{weeklyData.map((w,i)=>(
                <tr key={i} style={{borderBottom:`1px solid ${D.div}`}}>
                  <td style={{padding:"9px 12px",fontWeight:600,color:D.t1}}>{w.wk}</td>
                  <td style={{padding:"9px 12px",textAlign:"right",fontWeight:700,color:D.t1}}>{w.total}</td>
                  <td style={{padding:"9px 12px",textAlign:"right",color:D.ok,fontWeight:600}}>{w.resolved}</td>
                  <td style={{padding:"9px 12px",textAlign:"right",color:w.pending>0?D.wn:D.t3,fontWeight:600}}>{w.pending}</td>
                  <td style={{padding:"9px 12px",textAlign:"right",color:w.inProgress>0?D.p:D.t3,fontWeight:600}}>{w.inProgress}</td>
                  <td style={{padding:"9px 12px",textAlign:"right"}}><span style={{color:w.resolved/w.total>0.95?D.ok:D.wn,fontWeight:700}}>{Math.round(w.resolved/w.total*100)}%</span></td>
                </tr>
              ))}</tbody>
            </table>
          </Card>
        </div>
      )}
      {tab==="monthly"&&(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
            {SD.monthly.map(m=>(
              <div key={m.month} style={{background:D.card,borderRadius:D.r,boxShadow:D.sh1,padding:18,border:`1px solid ${D.div}`}}>
                <div style={{fontSize:13,fontWeight:700,color:D.t1,marginBottom:10}}>{m.month} 2026</div>
                <div style={{fontSize:32,fontWeight:800,color:D.p,lineHeight:1}}>{m.total}</div>
                <div style={{fontSize:10,color:D.t3,margin:"4px 0 10px"}}>total tickets</div>
                {[["Resolved",m.resolved,D.ok],["Pending",m.pending,D.wn],["In Progress",m.inProgress,D.p]].map(([l,v,c])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={{fontSize:11,color:D.t2}}>{l}</span>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <Bar2 value={v} max={m.total} color={c} h={4}/>
                      <span style={{fontSize:11,fontWeight:700,color:c,width:26,textAlign:"right"}}>{v}</span>
                    </div>
                  </div>
                ))}
                <div style={{marginTop:10,paddingTop:8,borderTop:`1px solid ${D.div}`,fontSize:12,fontWeight:700,color:m.rate>95?D.ok:D.wn}}>{m.rate}% resolve rate</div>
              </div>
            ))}
          </div>
          <Card title="Agent Performance by Month">
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={agentMonthly} margin={{left:-20,right:6,top:4,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke={D.div} vertical={false}/>
                <XAxis dataKey="month" tick={{fontSize:10,fill:D.t3}}/>
                <YAxis tick={{fontSize:9,fill:D.t3}}/>
                <Tooltip content={<CTip/>}/>
                <Legend wrapperStyle={{fontSize:11}}/>
                {SD.agents.map(a=><Bar key={a.name} dataKey={a.name} fill={a.color} radius={[3,3,0,0]}/>)}
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
      {tab==="yearly"&&(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
            <Kpi label="2026 Total" value={summary?.total||0} sub={`${summary?.dateFrom||""} – ${summary?.dateTo||""}`} border={D.p}/>
            <Kpi label="Resolved"   value={summary?.resolved||0} sub={`${summary?.total?Math.round(summary.resolved/summary.total*100):0}% rate`} border={D.ok}/>
            <Kpi label="Unresolved" value={(summary?.pending||0)+(summary?.inProgress||0)} sub={`${summary?.pending||0} pending / ${summary?.inProgress||0} in-progress`} border={D.wn} alert/>
          </div>
          <Card title="2026 YTD Monthly Trend">
            <ResponsiveContainer width="100%" height={190}>
               <BarChart data={monthly||[]} margin={{left:-20,right:6,top:4,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke={D.div} vertical={false}/>
                <XAxis dataKey="month" tick={{fontSize:10,fill:D.t3}}/>
                <YAxis tick={{fontSize:9,fill:D.t3}}/>
                <Tooltip content={<CTip/>}/>
                <Bar dataKey="total"    name="Total"    fill={D.p}  radius={[4,4,0,0]}/>
                <Bar dataKey="resolved" name="Resolved" fill={D.ok} radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <div style={{padding:"14px 18px",background:D.aLt,borderRadius:D.r,border:"1px solid #FCD34D",fontSize:12,color:"#92400E",fontWeight:500}}>
            Jan-May data not yet captured. Activate historical import via Apps Script to bring in pre-June tickets.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PAGE: AGENTS ─────────────────────────────────────────────────────────────
function AgentsPage({ agents }) {
  agents = agents || [];
  const agentMonthly = ["June","July","August"].map(label => {
    const k = label.substring(0,3).toLowerCase();
    const row = {month: label};
    agents.forEach(a => { row[a.name] = a[k] || 0; });
    return row;
  });
  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14}}>
        {agents.map(a=>(
          <div key={a.name} style={{background:D.card,borderRadius:D.r,boxShadow:D.sh1,padding:18,border:`1px solid ${D.div}`}}>
            <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
              <div style={{width:40,height:40,borderRadius:"50%",background:a.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,color:"white",flexShrink:0}}>{a.name[0]}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:700,color:D.t1}}>{a.name}</div>
                <div style={{display:"flex",gap:16,marginTop:12}}>
                  {[["Total",a.total,D.t1],["L1",a.l1,D.ok],["L3",a.l3,D.wn]].map(([l,v,c])=>(
                    <div key={l} style={{textAlign:"center"}}>
                      <div style={{fontSize:22,fontWeight:800,color:c}}>{v}</div>
                      <div style={{fontSize:10,color:D.t3,textTransform:"uppercase",letterSpacing:"0.06em"}}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:5}}>
              {[["Jun",a.jun||0],["Jul",a.jul||0],["Aug",a.aug||0]].map(([l,v])=>(
                <div key={l} style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:10,color:D.t3,width:22}}>{l}</span>
                  <Bar2 value={v} max={a.total} color={a.color} h={5}/>
                  <span style={{fontSize:11,fontWeight:600,color:D.t2,width:20,textAlign:"right"}}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Card title="Agent Comparison - All Months">
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={agentMonthly} margin={{left:-20,right:6,top:4,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke={D.div} vertical={false}/>
            <XAxis dataKey="month" tick={{fontSize:10,fill:D.t3}}/>
            <YAxis tick={{fontSize:9,fill:D.t3}}/>
            <Tooltip content={<CTip/>}/>
            <Legend wrapperStyle={{fontSize:11}}/>
            {agents.map(a=><Bar key={a.name} dataKey={a.name} fill={a.color} radius={[3,3,0,0]}/>)}
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ─── PAGE: UNSOLVED ──────────────────────────────────────────────────────────
function UnsolvedPage({fleet}) {
  const [filter, setFilter] = useState("all");
  const uns = fleet.unsolved;
  const filtered = filter==="all"?uns:uns.filter(r=>r[FX.ST]===filter);
  const catCount = {};
  uns.forEach(r=>{ catCount[r[FX.TY]]=(catCount[r[FX.TY]]||0)+1; });
  const catArr = Object.entries(catCount).sort((a,b)=>b[1]-a[1]);
  const custCount = {};
  uns.forEach(r=>{ custCount[r[FX.CS]]=(custCount[r[FX.CS]]||0)+1; });
  const custArr = Object.entries(custCount).sort((a,b)=>b[1]-a[1]).slice(0,8);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
        <Kpi label="Total Unresolved"    value={uns.length}                                      border={D.er} alert/>
        <Kpi label="Pending"             value={uns.filter(r=>r[FX.ST]==="pending").length}      border={D.wn}/>
        <Kpi label="In Progress"         value={uns.filter(r=>r[FX.ST]==="in progress").length}  border={D.p}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <Card title="Unresolved by Category">
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {catArr.map(([type,count])=>(
              <div key={type} style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{display:"flex",alignItems:"center",gap:5,width:200,flexShrink:0}}>
                  <div style={{width:7,height:7,borderRadius:2,background:CC[type]||"#94A3B8",flexShrink:0}}/>
                  <span style={{fontSize:11,color:D.t2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{type}</span>
                </div>
                <Bar2 value={count} max={catArr[0][1]} color={CC[type]||"#94A3B8"} h={6}/>
                <span style={{fontSize:12,fontWeight:700,color:D.t1,width:22,textAlign:"right"}}>{count}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Unresolved by Customer">
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {custArr.map(([cust,count])=>(
              <div key={cust} style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:11,color:D.t2,width:180,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cust}</span>
                <Bar2 value={count} max={custArr[0][1]} color={D.er} h={6}/>
                <span style={{fontSize:12,fontWeight:700,color:D.er,width:22,textAlign:"right"}}>{count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title={`All Unresolved Tickets (${filtered.length})`} noPad>
        <div style={{padding:"10px 14px",borderBottom:`1px solid ${D.div}`,display:"flex",gap:6,alignItems:"center"}}>
          {[["all","All"],["pending","Pending"],["in progress","In Progress"]].map(([k,l])=>(
            <button key={k} onClick={()=>setFilter(k)} style={{padding:"4px 12px",borderRadius:D.rs,border:`1px solid ${filter===k?D.p:D.bd}`,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:D.f,background:filter===k?D.pLt:"white",color:filter===k?D.p:D.t2}}>
              {l} <span style={{opacity:0.7}}>{k==="all"?uns.length:uns.filter(r=>r[FX.ST]===k).length}</span>
            </button>
          ))}
          <span style={{marginLeft:"auto",fontSize:10,color:D.t3}}>Note column: supervisor only · max 5 words</span>
        </div>
        <UnsolvedTable rows={filtered}/>
      </Card>
    </div>
  );
}

// ─── PAGE: CUSTOMERS ─────────────────────────────────────────────────────────
function CustomerList({fleet, onSelect}) {
  const [q, setQ] = useState("");
  const list = fleet.custArr.filter(c=>c.name.toLowerCase().includes(q.toLowerCase()));
  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",gap:10,alignItems:"center"}}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search customer..."
          style={{border:`1px solid ${D.bd}`,borderRadius:D.r,padding:"7px 12px",fontSize:13,fontFamily:D.f,color:D.t1,outline:"none",background:D.card,width:280}}/>
        <span style={{fontSize:12,color:D.t3}}>{list.length} customers</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
        {list.map(c=>(
          <div key={c.name} onClick={()=>onSelect(c.name)}
            style={{background:D.card,borderRadius:D.r,boxShadow:D.sh1,padding:14,cursor:"pointer",border:`1px solid ${D.div}`,transition:"all 0.12s"}}
            onMouseEnter={e=>{e.currentTarget.style.boxShadow=D.sh2;e.currentTarget.style.borderColor=D.p+"60";}}
            onMouseLeave={e=>{e.currentTarget.style.boxShadow=D.sh1;e.currentTarget.style.borderColor=D.div;}}>
            <div style={{fontWeight:700,fontSize:12,color:D.t1,marginBottom:8,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
              <span style={{background:D.pLt,color:D.p,fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:3}}>{c.tot} tickets</span>
              {c.robotCount>0&&<span style={{background:D.okBg,color:D.ok,fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:3}}>{c.robotCount} robots</span>}
              {(c.pend+c.opn)>0&&<span style={{background:D.erBg,color:D.er,fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:3}}>{c.pend+c.opn} open</span>}
            </div>
            <div style={{display:"flex",gap:1,height:4,borderRadius:2,overflow:"hidden"}}>
              {Object.entries(c.types).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([t,n])=>(
                <div key={t} title={`${t}: ${n}`} style={{flex:n,height:4,background:CC[t]||"#94A3B8"}}/>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomerDetail({name, fleet, onRobot, onBack}) {
  const cc = fleet.cmap[name];
  if (!cc) return <div style={{padding:20,color:D.t3}}>Customer not found.</div>;
  const robStats = cc.robots.map(rid=>fleet.rmap[rid]).filter(Boolean).sort((a,b)=>b.tot-a.tot);
  const catArr = Object.entries(cc.types).sort((a,b)=>b[1]-a[1]).map(([type,count])=>({type,count}));
  const resPie = [{name:"Resolved",value:cc.solv},{name:"Unresolved",value:cc.pend+cc.opn}].filter(x=>x.value>0);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <button onClick={onBack} style={{border:`1px solid ${D.bd}`,background:D.card,color:D.t2,borderRadius:D.r,padding:"6px 12px",cursor:"pointer",fontSize:12,fontFamily:D.f,fontWeight:500}}>Back</button>
        <div>
          <h2 style={{fontSize:15,fontWeight:800,color:D.t1,margin:0}}>{name}</h2>
          <span style={{fontSize:10,color:D.t3}}>{cc.tot} tickets · {cc.robotCount} tracked robots</span>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10}}>
        <Kpi label="Total"      value={cc.tot}         border={D.p}  small/>
        <Kpi label="L1"         value={cc.l1}          border={D.ok} small/>
        <Kpi label="L3"         value={cc.l3}          border={D.wn} small/>
        <Kpi label="Resolved"   value={cc.solv}        border={D.ok} small/>
        <Kpi label="Unresolved" value={cc.pend+cc.opn} border={(cc.pend+cc.opn)>2?D.er:D.wn} alert={(cc.pend+cc.opn)>2} small/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:14}}>
        <Card title="Issue Category Split">
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {catArr.map(cat=>(
              <div key={cat.type} style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{display:"flex",alignItems:"center",gap:5,width:200,flexShrink:0}}>
                  <div style={{width:7,height:7,borderRadius:2,background:CC[cat.type]||"#94A3B8",flexShrink:0}}/>
                  <span style={{fontSize:11,color:D.t2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cat.type}</span>
                </div>
                <Bar2 value={cat.count} max={cc.tot} color={CC[cat.type]||"#94A3B8"} h={6}/>
                <span style={{fontSize:12,fontWeight:700,color:D.t1,width:22,textAlign:"right"}}>{cat.count}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Resolution">
          <ResponsiveContainer width="100%" height={130}>
            <PieChart>
              <Pie data={resPie} dataKey="value" cx="50%" cy="50%" innerRadius={32} outerRadius={52} paddingAngle={3}>
                {resPie.map((_,i)=><Cell key={i} fill={[D.ok,D.er][i]}/>)}
              </Pie>
              <Tooltip/>
            </PieChart>
          </ResponsiveContainer>
          {resPie.map((p,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:11,marginTop:4}}>
              <span style={{color:D.t2,display:"flex",gap:5,alignItems:"center"}}><span style={{width:7,height:7,borderRadius:2,background:[D.ok,D.er][i],display:"inline-block"}}/>{p.name}</span>
              <span style={{fontWeight:700,color:D.t1}}>{p.value}</span>
            </div>
          ))}
        </Card>
      </div>
      {robStats.length>0&&(
        <Card title={`Tracked Robots (${robStats.length})`} sub="Click a robot for full ticket history">
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {robStats.map(rb=>{
              const sev=rb.tot>=20?D.er:rb.tot>=10?D.wn:D.ok;
              const top=Object.entries(rb.types).sort((a,b)=>b[1]-a[1])[0];
              return(
                <div key={rb.id} onClick={()=>onRobot(rb.id)}
                  style={{background:D.page,border:`1px solid ${D.bd}`,borderRadius:D.r,padding:"10px 12px",cursor:"pointer",minWidth:150,flexShrink:0,transition:"all 0.12s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=sev;e.currentTarget.style.boxShadow=D.sh1;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=D.bd;e.currentTarget.style.boxShadow="none";}}>
                  <RID id={rb.id}/>
                  <div style={{fontSize:24,fontWeight:800,color:sev,lineHeight:1,marginTop:7}}>{rb.tot}</div>
                  <div style={{fontSize:10,color:D.t3,marginBottom:5}}>tickets</div>
                  {top&&<Tag type={top[0]} sm/>}
                  {rb.tot>=10&&<div style={{fontSize:9,color:D.er,fontWeight:600,marginTop:4}}>Review needed</div>}
                </div>
              );
            })}
          </div>
        </Card>
      )}
      <Card title={`All Tickets (${cc.tot})`} noPad>
        <TicketTable rows={cc.tix.slice().reverse()} maxH={320}/>
      </Card>
    </div>
  );
}

function RobotDetail({robotId, fleet, onBack}) {
  const rb = fleet.rmap[robotId];
  if (!rb) return <div style={{padding:20,color:D.t3}}>Robot not found.</div>;
  const tix = rb.tix.slice().sort((a,b)=>a[FX.DT].localeCompare(b[FX.DT]));
  const typeArr = Object.entries(rb.types).sort((a,b)=>b[1]-a[1]).map(([type,count])=>({type,count}));
  const sev = rb.tot>=20?D.er:rb.tot>=10?D.wn:D.ok;
  const l3c = tix.filter(r=>r[FX.LV]==="L3").length;
  const solv = tix.filter(r=>r[FX.ST]==="solved"||r[FX.ST]==="closed").length;
  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <button onClick={onBack} style={{border:`1px solid ${D.bd}`,background:D.card,color:D.t2,borderRadius:D.r,padding:"6px 12px",cursor:"pointer",fontSize:12,fontFamily:D.f}}>Back</button>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <RID id={robotId}/>
            {rb.tot>=10&&<span style={{fontSize:10,fontWeight:600,color:D.er,background:D.erBg,padding:"2px 8px",borderRadius:D.rs}}>Anomaly — {rb.tot} tickets</span>}
          </div>
          <div style={{fontSize:10,color:D.t3,marginTop:2}}>{rb.cust}</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
        <Kpi label="Total"     value={rb.tot}          border={sev}  small/>
        <Kpi label="L3"        value={l3c}             border={D.wn} small/>
        <Kpi label="Resolved"  value={solv}            border={D.ok} small/>
        <Kpi label="Unresolved" value={tix.length-solv} border={(tix.length-solv)>0?D.er:D.t3} alert={(tix.length-solv)>0} small/>
      </div>
      <Card title="Error Pattern">
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {typeArr.map(t=>(
            <div key={t.type} style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{width:200,fontSize:11,color:D.t2,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.type}</span>
              <Bar2 value={t.count} max={rb.tot} color={CC[t.type]||"#94A3B8"} h={6}/>
              <span style={{fontSize:12,fontWeight:700,color:CC[t.type]||D.t1,width:22,textAlign:"right"}}>{t.count}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card title={`Ticket History (${tix.length})`} noPad>
        <TicketTable rows={tix} maxH={400}/>
      </Card>
    </div>
  );
}

// ─── PAGE: ANOMALIES — notification-style, mark-as-read, history ─────────────
const AN_ICON = {robot:"🤖",stale:"⏰",spike:"📈"};
const AN_LABEL = {robot:"Robot Pattern",stale:"Stale Tickets",spike:"Volume Spike"};

function AnomalyDetail({a, fleet, onOpenRobot}){
  if(!a) return(
    <div style={{background:D.card,borderRadius:D.r,border:`1px solid ${D.div}`,padding:"60px 20px",textAlign:"center",color:D.t3,height:"100%"}}>
      <div style={{fontSize:22,marginBottom:8}}>◁</div>
      <div style={{fontSize:12}}>Select an anomaly to see full details</div>
    </div>
  );
  const rb = a.robot ? fleet.rmap[a.robot] : null;
  const allRelated = rb ? rb.tix.slice().sort((x,y)=>x[FX.DT].localeCompare(y[FX.DT])) : (a.tix||[]);
  return(
    <div style={{background:D.card,borderRadius:D.r,border:`1px solid ${D.bd}`,boxShadow:D.sh1,overflow:"hidden"}}>
      <div style={{padding:"14px 18px",borderLeft:`3px solid ${a.lvl==="critical"?D.er:D.wn}`,borderBottom:`1px solid ${D.div}`}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <span style={{fontSize:18}}>{AN_ICON[a.type]||"⚠"}</span>
          <span style={{fontSize:10,fontWeight:700,color:a.lvl==="critical"?D.er:D.wn,textTransform:"uppercase",letterSpacing:"0.06em"}}>{AN_LABEL[a.type]||a.type}</span>
          <span style={{marginLeft:"auto",fontSize:20,fontWeight:800,color:a.lvl==="critical"?D.er:D.wn}}>{a.count}</span>
        </div>
        <div style={{fontSize:15,fontWeight:700,color:D.t1,marginBottom:4}}>{a.title}</div>
        <div style={{fontSize:12,color:D.t2,lineHeight:1.6}}>{a.desc}</div>
        <div style={{display:"flex",gap:8,marginTop:10}}>
          {a.robot&&(
            <button onClick={()=>onOpenRobot&&onOpenRobot(a.robot)} style={{background:D.pLt,color:D.p,border:"none",borderRadius:D.rs,padding:"5px 12px",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:D.f}}>
              Open robot {a.robot} →
            </button>
          )}
          {a.cust&&<span style={{fontSize:11,color:D.t3,alignSelf:"center"}}>{a.cust}</span>}
        </div>
      </div>
      <div style={{padding:"12px 18px"}}>
        <div style={{fontSize:10,color:D.t3,fontWeight:600,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>
          {rb ? `All ${rb.tot} tickets for this robot` : a.tix ? `Sample tickets (${a.tix.length} of ${a.count})` : "No linked tickets"}
        </div>
        {allRelated.length>0 && <TicketTable rows={allRelated.slice().reverse()} maxH={360}/>}
      </div>
    </div>
  );
}

function AnomalyPage({fleet, onOpenRobot}) {
  const allAnomalies = fleet.anomalies;
  const [readIds, setReadIds] = useState(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [selId, setSelId] = useState(allAnomalies[0]?.id || null);

  const active  = allAnomalies.filter(a=>!readIds.has(a.id));
  const history = allAnomalies.filter(a=>readIds.has(a.id));
  const selected = allAnomalies.find(a=>a.id===selId) || null;

  const markRead = (id) => { setReadIds(prev=>new Set([...prev, id])); if(selId===id) setSelId(null); };
  const markAllRead = () => { setReadIds(new Set(allAnomalies.map(a=>a.id))); setSelId(null); };
  const restore = (id) => setReadIds(prev=>{ const n=new Set(prev); n.delete(id); return n; });

  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <span style={{fontSize:13,fontWeight:700,color:D.t1}}>Active Anomalies</span>
          {active.length>0&&<span style={{marginLeft:8,background:D.erBg,color:D.er,fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:99}}>{active.length} new</span>}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {active.length>0&&(
            <button onClick={markAllRead} style={{border:`1px solid ${D.bd}`,background:D.card,color:D.t2,borderRadius:D.rs,padding:"5px 12px",cursor:"pointer",fontSize:11,fontFamily:D.f,fontWeight:500}}>
              Mark all read
            </button>
          )}
          <button onClick={()=>setShowHistory(h=>!h)} style={{border:`1px solid ${D.bd}`,background:showHistory?D.div:D.card,color:D.t2,borderRadius:D.rs,padding:"5px 12px",cursor:"pointer",fontSize:11,fontFamily:D.f,fontWeight:500}}>
            History ({history.length})
          </button>
        </div>
      </div>

      {active.length===0&&!showHistory&&(
        <div style={{background:D.card,borderRadius:D.r,border:`1px solid ${D.div}`,padding:"36px 20px",textAlign:"center",color:D.t3}}>
          <div style={{fontSize:24,marginBottom:8}}>✓</div>
          <div style={{fontSize:13,fontWeight:500,color:D.t2}}>No active anomalies</div>
          <div style={{fontSize:11,marginTop:4}}>All clear. Check history for past alerts.</div>
        </div>
      )}

      {active.length>0&&(
        <div style={{display:"grid",gridTemplateColumns:"340px 1fr",gap:14,alignItems:"start"}}>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {active.map(a=>{
              const isSel=selId===a.id;
              return(
                <div key={a.id} onClick={()=>setSelId(a.id)}
                  style={{background:isSel?D.pLt:D.card,borderRadius:D.r,border:`1px solid ${isSel?D.p:D.bd}`,boxShadow:D.sh1,overflow:"hidden",cursor:"pointer",borderLeft:`3px solid ${a.lvl==="critical"?D.er:D.wn}`,transition:"all 0.12s"}}>
                  <div style={{padding:"10px 12px",display:"flex",gap:10,alignItems:"flex-start"}}>
                    <span style={{fontSize:14,flexShrink:0,marginTop:1}}>{AN_ICON[a.type]||"⚠"}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:9,fontWeight:700,color:a.lvl==="critical"?D.er:D.wn,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:2}}>{AN_LABEL[a.type]||a.type}</div>
                      <div style={{fontSize:12,fontWeight:600,color:D.t1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.title}</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5,flexShrink:0}}>
                      <span style={{fontSize:14,fontWeight:800,color:a.lvl==="critical"?D.er:D.wn}}>{a.count}</span>
                      <button onClick={e=>{e.stopPropagation();markRead(a.id);}} style={{background:"none",border:"none",color:D.t3,cursor:"pointer",fontSize:9,textDecoration:"underline",padding:0}}>
                        mark read
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <AnomalyDetail a={selected} fleet={fleet} onOpenRobot={onOpenRobot}/>
        </div>
      )}

      {showHistory&&(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div style={{fontSize:11,fontWeight:600,color:D.t3,textTransform:"uppercase",letterSpacing:"0.06em",paddingTop:4}}>History — marked as read</div>
          {history.length===0&&<div style={{fontSize:12,color:D.t3,padding:"12px 0"}}>No history yet.</div>}
          {history.map(a=>(
            <div key={a.id} style={{background:D.div,borderRadius:D.r,border:`1px solid ${D.bd}`,padding:"10px 14px",display:"flex",gap:10,alignItems:"center",opacity:0.75}}>
              <span style={{fontSize:13}}>{AN_ICON[a.type]||"⚠"}</span>
              <div style={{flex:1}}>
                <span style={{fontSize:11,fontWeight:600,color:D.t2}}>{a.title}</span>
                <span style={{fontSize:10,color:D.t3,marginLeft:8}}>{AN_LABEL[a.type]}</span>
              </div>
              <button onClick={()=>restore(a.id)} style={{background:"none",border:`1px solid ${D.bd}`,borderRadius:D.rs,padding:"3px 8px",cursor:"pointer",fontSize:10,color:D.t3,fontFamily:D.f}}>Restore</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── NAV ─────────────────────────────────────────────────────────────────────
const NAV=[
  {group:"Operations",items:[
    {id:"overview",  label:"Overview",      icon:"▣"},
    {id:"shift",     label:"Shift Summary", icon:"▤"},
    {id:"agents",    label:"Agents",        icon:"◈"},
    {id:"unsolved",  label:"Unsolved",      icon:"⚑", badge:"unsolved"},
  ]},
  {group:"Intelligence",items:[
    {id:"customers", label:"Customers",     icon:"⊞"},
    {id:"anomalies", label:"Anomalies",     icon:"△", badge:"anomaly"},
  ]},
];

// ─── ROOT ─────────────────────────────────────────────────────────────────────
const AGENT_COLORS = [D.p, D.ok, D.wn, D.er, D.pu, D.cy];

export default function App() {
  const [view,     setView]     = useState("overview");
  const [selCust,  setSelCust]  = useState(null);
  const [selRobot, setSelRobot] = useState(null);

  const { loading, error, data, role, ts } = useLiveData();

  const summary = useMemo(() => adaptSummary(data),  [data]);
  const monthly = useMemo(() => adaptMonthly(data),  [data]);
  const daily   = useMemo(() => adaptDaily(data),    [data]);
  const shifts  = useMemo(() => adaptShifts(data),   [data]);
  const cats    = useMemo(() => adaptCats(data),     [data]);
  const fleet   = useMemo(() => adaptFleet(data),    [data]);
  const agents  = useMemo(() => adaptAgents(data).map((a, i) => ({
    ...a, color: AGENT_COLORS[i % AGENT_COLORS.length],
  })), [data]);

  const navTo = (v) => { setView(v); setSelCust(null); setSelRobot(null); };

  const pageTitle = ({
    overview:  "Overview",
    shift:     "Shift Summary",
    agents:    "Agents",
    unsolved:  "Unsolved Tickets",
    customers: selRobot ? "Robot Detail" : selCust ? "Customer Detail" : "Customers",
    anomalies: "Anomalies",
  })[view] || "Dashboard";

  if (loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      height:"100vh",background:D.page,flexDirection:"column",gap:12,fontFamily:D.f}}>
      <div style={{fontSize:13,color:D.t2}}>Connecting to live data…</div>
      <div style={{fontSize:10,color:D.t3}}>Fetching from Google Sheets</div>
    </div>
  );

  if (error) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      height:"100vh",background:D.page,flexDirection:"column",gap:12,padding:32,fontFamily:D.f}}>
      <div style={{fontSize:13,color:D.er,fontWeight:700}}>Connection failed</div>
      <div style={{fontSize:11,color:D.t3,maxWidth:380,textAlign:"center",lineHeight:1.7}}>{error}</div>
      <div style={{fontSize:10,color:D.t3,marginTop:4}}>Check: Web App deployed · email in AccessList</div>
    </div>
  );

  return (
    <div style={{display:"flex",minHeight:"100vh",background:D.page,fontFamily:D.f,color:D.t1,fontSize:14}}>
      <div style={{width:D.sw,background:D.sidebar,flexShrink:0,display:"flex",flexDirection:"column",position:"fixed",top:0,left:0,height:"100vh",zIndex:10,boxShadow:"2px 0 8px rgba(0,0,0,0.14)"}}>
        <div style={{padding:"18px 16px 14px",borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:26,height:26,borderRadius:6,background:D.sidebarA,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"white",fontFamily:D.fm}}>ZR</div>
            <div>
              <div style={{fontSize:11,fontWeight:800,color:"white",letterSpacing:"0.1em",textTransform:"uppercase"}}>ZRA CEC</div>
              <div style={{fontSize:9,color:D.sN,marginTop:1}}>Customer Excellence Center</div>
            </div>
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto",paddingTop:6}}>
          {NAV.map(g=>({
            ...g,
            items: g.items.filter(item => role==="internal" || item.id!=="agents"),
          })).map(g=>(
            <div key={g.group} style={{marginBottom:6}}>
              <div style={{fontSize:9,fontWeight:700,color:D.sSec,padding:"8px 16px 3px",textTransform:"uppercase",letterSpacing:"0.1em"}}>{g.group}</div>
              {g.items.map(item=>{
                const active=view===item.id;
                const badge=item.badge==="unsolved"?fleet?.unsolved?.length||0:item.badge==="anomaly"?fleet?.anomalies?.length||0:0;
                return(
                  <div key={item.id} onClick={()=>navTo(item.id)}
                    style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px 8px 14px",cursor:"pointer",borderRadius:6,margin:"1px 6px",background:active?D.sidebarA:"transparent",color:active?D.sA:D.sN,fontWeight:active?600:400,borderLeft:active?"2px solid #93C5FD":"2px solid transparent"}}
                    onMouseEnter={e=>{if(!active){e.currentTarget.style.background=D.sidebarH;e.currentTarget.style.color="#DBEAFE";}}}
                    onMouseLeave={e=>{if(!active){e.currentTarget.style.background="transparent";e.currentTarget.style.color=D.sN;}}}>
                    <span style={{fontSize:11,opacity:0.85}}>{item.icon}</span>
                    <span style={{fontSize:12}}>{item.label}</span>
                    {badge>0&&<span style={{background:D.er,color:"white",fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:99,marginLeft:"auto"}}>{badge}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{padding:12,borderTop:"1px solid rgba(255,255,255,0.08)"}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:5,height:5,borderRadius:"50%",background:D.ok}}/>
            <span style={{fontSize:10,color:D.sN}}>LIVE · {ts?new Date(ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"—"}</span>
          </div>
        </div>
      </div>

      <div style={{marginLeft:D.sw,flex:1,display:"flex",flexDirection:"column"}}>
        <div style={{position:"sticky",top:0,zIndex:9,background:"#FFFFFF",borderBottom:`1px solid ${D.div}`,height:D.hh,display:"flex",alignItems:"center",padding:"0 22px",gap:10,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:700,color:D.t1}}>{pageTitle}</div>
            {selRobot&&<div style={{fontSize:10,color:D.t3,marginTop:1,fontFamily:D.fm}}>{selRobot}</div>}
            {selCust&&!selRobot&&<div style={{fontSize:10,color:D.t3,marginTop:1}}>{selCust}</div>}
          </div>
          <span style={{background:D.pLt,color:D.p,fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:99}}>{summary?.dateFrom} – {summary?.dateTo}</span>
          <span style={{background:D.div,color:D.t3,fontSize:10,padding:"3px 10px",borderRadius:99}}>{summary?.total??'—'} tickets</span>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:20}}>
          {view==="overview"  && <Overview summary={summary} monthly={monthly} daily={daily} shifts={shifts} agents={agents} cats={cats}/>}
          {view==="shift"     && <ShiftSummary monthly={monthly} daily={daily} agents={agents} summary={summary}/>}
          {view==="agents"    && <AgentsPage agents={agents}/>}
          {view==="unsolved"  && <UnsolvedPage fleet={fleet}/>}
          {view==="customers" && !selCust  && <CustomerList fleet={fleet} onSelect={setSelCust}/>}
          {view==="customers" && selCust && !selRobot && <CustomerDetail name={selCust} fleet={fleet} onRobot={setSelRobot} onBack={()=>setSelCust(null)}/>}
          {view==="customers" && selCust && selRobot  && <RobotDetail robotId={selRobot} fleet={fleet} onBack={()=>setSelRobot(null)}/>}
          {view==="anomalies" && <AnomalyPage fleet={fleet} onOpenRobot={id=>{setSelRobot(id);setSelCust(fleet?.rmap?.[id]?.cust||null);setView("customers");}}/>}
        </div>
      </div>
    </div>
  );
}