import { MultiAIBrain } from './src/lib/ai/Orchestrator';
import { initializeSystemAbstractions } from './src/lib/core/SystemBoot';

initializeSystemAbstractions();

(async () => {
   try {
     const res = await MultiAIBrain.execute({
        prompt: "how are you doing today?",
        agentRole: "customer",
        history: []
     });
     console.log("RESULT:", res);
   } catch(e) {
     console.error("TEST ERROR:", e);
   }
})();
