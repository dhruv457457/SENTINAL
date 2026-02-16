import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const DeployModule = buildModule("SentinalDeploy", (m) => {
  
  // Deploy ReserveOracle
  const oracle = m.contract("ReserveOracle");
  
  // Deploy EmergencyController
  const controller = m.contract("EmergencyController");
  
  // Link contracts
  m.call(oracle, "setEmergencyController", [controller]);
  m.call(controller, "setOracle", [oracle]);
  
  return { oracle, controller };
});

export default DeployModule;