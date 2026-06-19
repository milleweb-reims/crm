import { Header } from "@/components/header";
import { PipelineBoard } from "@/components/pipeline-board";

export default function PipelinePage() {
  return (
    <>
      <Header
        title="Pipeline"
        description="Glissez-déposez les prospects entre les étapes"
      />
      <PipelineBoard />
    </>
  );
}
