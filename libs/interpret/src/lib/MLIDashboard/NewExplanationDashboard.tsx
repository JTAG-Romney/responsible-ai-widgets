import React from "react";
import { ModelMetadata } from "@responsible-ai/mlchartlib";
import memoize from "memoize-one";
import {
  IPivotItemProps,
  PivotItem,
  Pivot,
  PivotLinkSize,
  mergeStyleSets,
  loadTheme,
  MessageBar,
  MessageBarType,
  Text,
  Link
} from "office-ui-fabric-react";
import _ from "lodash";

import { initializeIcons } from "@uifabric/icons";
import { localization } from "../Localization/localization";
import { JointDataset } from "./JointDataset";
import { IExplanationModelMetadata, ModelTypes } from "./IExplanationContext";
import {
  GlobalExplanationTab,
  IGlobalBarSettings
} from "./Controls/GlobalExplanationTab/GlobalExplanationTab";
import { WhatIfTab } from "./Controls/WhatIfTab/WhatIfTab";
import { Cohort } from "./Cohort";
import { ModelPerformanceTab } from "./Controls/ModelPerformanceTab/ModelPerformanceTab";
import { defaultTheme } from "./Themes";
import { CohortList } from "./Controls/CohortList/CohortList";
import { explanationDashboardStyles } from "./NewExplanationDashboard.styles";
import { DatasetExplorerTab } from "./Controls/DatasetExplorerTab/DatasetExplorerTab";
import { ValidateProperties } from "./ValidateProperties";
import { CohortEditor, ICohort } from "./Controls/CohortEditor/CohortEditor";
import { WeightVectors, WeightVectorOption } from "./IWeightedDropdownContext";
import { IGenericChartProps } from "./IGenericChartProps";
import {
  IExplanationDashboardProps,
  IMultiClassLocalFeatureImportance,
  ISingleClassLocalFeatureImportance
} from "./Interfaces/IExplanationDashboardProps";
import { TelemetryLevels } from "./Interfaces/ITelemetryMessage";

export interface INewExplanationDashboardState {
  cohorts: Cohort[];
  activeGlobalTab: globalTabKeys;
  jointDataset: JointDataset;
  modelMetadata: IExplanationModelMetadata;
  modelChartConfig?: IGenericChartProps;
  dataChartConfig?: IGenericChartProps;
  whatIfChartConfig?: IGenericChartProps;
  globalBarConfig?: IGlobalBarSettings;
  dependenceProps?: IGenericChartProps;
  globalImportanceIntercept: number[];
  globalImportance: number[][];
  isGlobalImportanceDerivedFromLocal: boolean;
  sortVector?: number[];
  validationWarnings: string[];
  showingDatasizeWarning: boolean;
  editingCohortIndex?: number;
  selectedWeightVector: WeightVectorOption;
  requestPredictions?: (
    request: any[],
    abortSignal: AbortSignal
  ) => Promise<any[]>;
}

// features x classes
interface IGlobalExplanationProps {
  globalImportanceIntercept: number[];
  globalImportance: number[][];
  isGlobalImportanceDerivedFromLocal: boolean;
}

export interface ISelectorConfig {
  property: string;
  index?: number;
  options: {
    dither?: boolean;
    // this is only used in the ambiguous case of numeric values on color axis for scatter chart, when binned or unbinned are valid
    bin?: boolean;
  };
}

enum globalTabKeys {
  modelPerformance = "modelPerformance",
  dataExploration = "dataExploration",
  explanationTab = "explanationTab",
  whatIfTab = "whatIfTab"
}

export class NewExplanationDashboard extends React.PureComponent<
  IExplanationDashboardProps,
  INewExplanationDashboardState
> {
  private static iconsInitialized = false;
  private static ROW_WARNING_SIZE = 6000;

  private static readonly classNames = mergeStyleSets({
    pivotWrapper: {
      display: "contents"
    }
  });

  private static getClassLength: (
    props: IExplanationDashboardProps
  ) => number = memoize((props: IExplanationDashboardProps): number => {
    if (
      props.precomputedExplanations &&
      props.precomputedExplanations.localFeatureImportance &&
      props.precomputedExplanations.localFeatureImportance.scores
    ) {
      const localImportances =
        props.precomputedExplanations.localFeatureImportance.scores;
      if (
        (localImportances as number[][][]).every((dim1) => {
          return dim1.every((dim2) => Array.isArray(dim2));
        })
      ) {
        return localImportances.length;
      }
      // 2d is regression (could be a non-scikit convention binary, but that is not supported)
      return 1;
    }
    if (
      props.precomputedExplanations &&
      props.precomputedExplanations.globalFeatureImportance &&
      props.precomputedExplanations.globalFeatureImportance.scores
    ) {
      // determine if passed in vaules is 1D or 2D
      if (
        (props.precomputedExplanations.globalFeatureImportance
          .scores as number[][]).every((dim1) => Array.isArray(dim1))
      ) {
        return (props.precomputedExplanations.globalFeatureImportance
          .scores as number[][])[0].length;
      }
    }
    if (
      props.probabilityY &&
      Array.isArray(props.probabilityY) &&
      Array.isArray(props.probabilityY[0]) &&
      props.probabilityY[0].length > 0
    ) {
      return props.probabilityY[0].length;
    }
    // default to regression case
    return 1;
  });

  private pivotItems: IPivotItemProps[] = [];
  private weightVectorOptions: WeightVectorOption[] = [];
  private weightVectorLabels = {};
  public constructor(props: IExplanationDashboardProps) {
    super(props);
    NewExplanationDashboard.initializeIcons(props);
    loadTheme(props.theme || defaultTheme);
    if (this.props.locale) {
      localization.setLanguage(this.props.locale);
    }
    this.state = NewExplanationDashboard.buildInitialExplanationContext(
      _.cloneDeep(props)
    );
    this.validatePredictMethod();

    this.weightVectorLabels = {
      [WeightVectors.absAvg]: localization.absoluteAverage
    };
    if (this.state.modelMetadata.modelType === ModelTypes.multiclass) {
      this.weightVectorOptions.push(WeightVectors.absAvg);
    }
    this.state.modelMetadata.classNames.forEach((name, index) => {
      this.weightVectorLabels[index] = localization.formatString(
        localization.WhatIfTab.classLabel,
        name
      );
      this.weightVectorOptions.push(index);
    });

    this.pivotItems.push({
      headerText: localization.modelPerformance,
      itemKey: globalTabKeys.modelPerformance
    });
    this.pivotItems.push({
      headerText: localization.datasetExplorer,
      itemKey: globalTabKeys.dataExploration
    });
    this.pivotItems.push({
      headerText: localization.aggregateFeatureImportance,
      itemKey: globalTabKeys.explanationTab
    });
    this.pivotItems.push({
      headerText: localization.individualAndWhatIf,
      itemKey: globalTabKeys.whatIfTab
    });
  }

  public static buildInitialExplanationContext(
    props: IExplanationDashboardProps
  ): INewExplanationDashboardState {
    const modelMetadata = NewExplanationDashboard.buildModelMetadata(props);
    const validationCheck = new ValidateProperties(props, modelMetadata);

    let localExplanations:
      | IMultiClassLocalFeatureImportance
      | ISingleClassLocalFeatureImportance
      | undefined;
    if (
      props &&
      props.precomputedExplanations &&
      props.precomputedExplanations.localFeatureImportance &&
      props.precomputedExplanations.localFeatureImportance.scores
    ) {
      localExplanations = props.precomputedExplanations.localFeatureImportance;
    }
    const jointDataset = new JointDataset({
      dataset: props.testData,
      predictedY: props.predictedY,
      predictedProbabilities: props.probabilityY,
      trueY: props.trueY,
      localExplanations,
      metadata: modelMetadata
    });
    const globalProps = NewExplanationDashboard.buildGlobalProperties(props);
    // consider taking filters in as param arg for programatic users
    const cohorts = [
      new Cohort(localization.Cohort.defaultLabel, jointDataset, [])
    ];
    if (
      validationCheck.errorStrings.length !== 0 &&
      props.telemetryHook !== undefined
    ) {
      props.telemetryHook({
        message: "Invalid inputs",
        level: TelemetryLevels.error,
        context: validationCheck.errorStrings.length
      });
    }
    return {
      cohorts,
      validationWarnings: validationCheck.errorStrings,
      activeGlobalTab: globalTabKeys.modelPerformance,
      jointDataset,
      modelMetadata,
      modelChartConfig: undefined,
      dataChartConfig: undefined,
      whatIfChartConfig: undefined,
      dependenceProps: undefined,
      globalBarConfig: undefined,
      globalImportanceIntercept: globalProps.globalImportanceIntercept,
      globalImportance: globalProps.globalImportance,
      isGlobalImportanceDerivedFromLocal:
        globalProps.isGlobalImportanceDerivedFromLocal,
      sortVector: undefined,
      showingDatasizeWarning:
        jointDataset.datasetRowCount > NewExplanationDashboard.ROW_WARNING_SIZE,
      selectedWeightVector:
        modelMetadata.modelType === ModelTypes.multiclass
          ? WeightVectors.absAvg
          : 0
    };
  }
  private static initializeIcons(props: IExplanationDashboardProps): void {
    if (
      NewExplanationDashboard.iconsInitialized === false &&
      props.shouldInitializeIcons !== false
    ) {
      initializeIcons(props.iconUrl);
      NewExplanationDashboard.iconsInitialized = true;
    }
  }

  private static buildModelMetadata(
    props: IExplanationDashboardProps
  ): IExplanationModelMetadata {
    const modelType = NewExplanationDashboard.getModelType(props);
    let featureNames = props.dataSummary.featureNames;
    let featureNamesAbridged: string[];
    const maxLength = 18;
    if (featureNames !== undefined) {
      if (!featureNames.every((name) => typeof name === "string")) {
        featureNames = featureNames.map((x) => x.toString());
      }
      featureNamesAbridged = featureNames.map((name) => {
        return name.length <= maxLength
          ? name
          : `${name.slice(0, maxLength)}...`;
      });
    } else {
      let featureLength = 0;
      if (props.testData && props.testData[0] !== undefined) {
        featureLength = props.testData[0].length;
      } else if (
        props.precomputedExplanations &&
        props.precomputedExplanations.globalFeatureImportance
      ) {
        featureLength =
          props.precomputedExplanations.globalFeatureImportance.scores.length;
      } else if (
        props.precomputedExplanations &&
        props.precomputedExplanations.localFeatureImportance
      ) {
        const localImportances =
          props.precomputedExplanations.localFeatureImportance.scores;
        if (
          (localImportances as number[][][]).every((dim1) => {
            return dim1.every((dim2) => Array.isArray(dim2));
          })
        ) {
          featureLength = (props.precomputedExplanations.localFeatureImportance
            .scores[0][0] as number[]).length;
        } else {
          featureLength = (props.precomputedExplanations.localFeatureImportance
            .scores[0] as number[]).length;
        }
      } else if (
        props.precomputedExplanations &&
        props.precomputedExplanations.ebmGlobalExplanation
      ) {
        featureLength =
          props.precomputedExplanations.ebmGlobalExplanation.feature_list
            .length;
      }
      featureNames = NewExplanationDashboard.buildIndexedNames(
        featureLength,
        localization.defaultFeatureNames
      );
      featureNamesAbridged = featureNames;
    }
    let classNames = props.dataSummary.classNames;
    const classLength = NewExplanationDashboard.getClassLength(props);
    if (!classNames || classNames.length !== classLength) {
      classNames = NewExplanationDashboard.buildIndexedNames(
        classLength,
        localization.defaultClassNames
      );
    }
    const featureIsCategorical = ModelMetadata.buildIsCategorical(
      featureNames.length,
      props.testData,
      props.dataSummary.categoricalMap
    );
    const featureRanges = ModelMetadata.buildFeatureRanges(
      props.testData,
      featureIsCategorical,
      props.dataSummary.categoricalMap
    );
    return {
      featureNames,
      featureNamesAbridged,
      classNames,
      featureIsCategorical,
      featureRanges,
      modelType
    };
  }

  private static buildIndexedNames(
    length: number,
    baseString: string
  ): string[] {
    return Array.from(Array(length).keys()).map((i) =>
      localization.formatString(baseString, i.toString())
    );
  }

  private static getModelType(props: IExplanationDashboardProps): ModelTypes {
    // If python gave us a hint, use it
    if (props.modelInformation.method === "regressor") {
      return ModelTypes.regression;
    }
    switch (NewExplanationDashboard.getClassLength(props)) {
      case 1:
        return ModelTypes.regression;
      case 2:
        return ModelTypes.binary;
      default:
        return ModelTypes.multiclass;
    }
  }

  private static buildGlobalProperties(
    props: IExplanationDashboardProps
  ): IGlobalExplanationProps {
    const result: IGlobalExplanationProps = {} as IGlobalExplanationProps;
    if (
      props.precomputedExplanations &&
      props.precomputedExplanations.globalFeatureImportance &&
      props.precomputedExplanations.globalFeatureImportance.scores
    ) {
      result.isGlobalImportanceDerivedFromLocal = false;
      if (
        (props.precomputedExplanations.globalFeatureImportance
          .scores as number[][]).every((dim1) => Array.isArray(dim1))
      ) {
        result.globalImportance = props.precomputedExplanations
          .globalFeatureImportance.scores as number[][];
        result.globalImportanceIntercept = props.precomputedExplanations
          .globalFeatureImportance.intercept as number[];
      } else {
        result.globalImportance = (props.precomputedExplanations
          .globalFeatureImportance.scores as number[]).map((value) => [value]);
        result.globalImportanceIntercept = [
          props.precomputedExplanations.globalFeatureImportance
            .intercept as number
        ];
      }
    }
    return result;
  }

  public render(): React.ReactNode {
    const cohortIDs = this.state.cohorts.map((cohort) =>
      cohort.getCohortID().toString()
    );
    const classNames = explanationDashboardStyles();
    let cohortForEdit: ICohort | undefined;
    if (this.state.editingCohortIndex !== undefined) {
      if (this.state.editingCohortIndex === this.state.cohorts.length) {
        cohortForEdit = {
          cohortName: localization.formatString(
            localization.CohortEditor.placeholderName,
            this.state.editingCohortIndex
          ),
          filterList: []
        };
      } else {
        cohortForEdit = {
          cohortName: this.state.cohorts[this.state.editingCohortIndex].name,
          filterList: [
            ...this.state.cohorts[this.state.editingCohortIndex].filters
          ]
        };
      }
    }
    return (
      <div className={classNames.page} style={{ maxHeight: "1000px" }}>
        {this.state.showingDatasizeWarning && (
          <MessageBar
            onDismiss={this.clearSizeWarning}
            dismissButtonAriaLabel="Close"
            messageBarType={MessageBarType.warning}
          >
            <div>
              <Text>{localization.ValidationErrors.datasizeWarning}</Text>
              <Link onClick={this.openCohort.bind(this, 0)}>
                {localization.ValidationErrors.addFilters}
              </Link>
            </div>
          </MessageBar>
        )}
        {this.state.validationWarnings.length !== 0 && (
          <MessageBar
            onDismiss={this.clearWarning}
            dismissButtonAriaLabel="Close"
            messageBarType={MessageBarType.warning}
          >
            <div>
              <Text block>{localization.ValidationErrors.errorHeader}</Text>
              {this.state.validationWarnings.map((message) => {
                return <Text block>{message}</Text>;
              })}
            </div>
          </MessageBar>
        )}
        <CohortList
          cohorts={this.state.cohorts}
          jointDataset={this.state.jointDataset}
          metadata={this.state.modelMetadata}
          editCohort={this.openCohort}
          cloneAndEdit={this.cloneAndOpenCohort}
        />
        {cohortForEdit !== undefined && (
          <CohortEditor
            jointDataset={this.state.jointDataset}
            filterList={cohortForEdit.filterList}
            cohortName={cohortForEdit.cohortName}
            onSave={this.onCohortChange}
            onCancel={this.closeCohortEditor}
            onDelete={this.deleteCohort}
            isNewCohort={
              this.state.editingCohortIndex === this.state.cohorts.length
            }
            deleteIsDisabled={this.state.cohorts.length === 1}
          />
        )}
        <div className={NewExplanationDashboard.classNames.pivotWrapper}>
          <Pivot
            selectedKey={this.state.activeGlobalTab}
            onLinkClick={this.handleGlobalTabClick}
            linkSize={PivotLinkSize.normal}
            headersOnly={true}
            styles={{ root: classNames.pivotLabelWrapper }}
          >
            {this.pivotItems.map((props) => (
              <PivotItem key={props.itemKey} {...props} />
            ))}
          </Pivot>
          {this.state.activeGlobalTab === globalTabKeys.modelPerformance && (
            <ModelPerformanceTab
              jointDataset={this.state.jointDataset}
              metadata={this.state.modelMetadata}
              chartProps={this.state.modelChartConfig}
              onChange={this.onModelConfigChanged}
              cohorts={this.state.cohorts}
            />
          )}
          {this.state.activeGlobalTab === globalTabKeys.dataExploration && (
            <DatasetExplorerTab
              jointDataset={this.state.jointDataset}
              metadata={this.state.modelMetadata}
              chartProps={this.state.dataChartConfig}
              onChange={this.onConfigChanged}
              cohorts={this.state.cohorts}
              editCohort={this.openCohort}
            />
          )}
          {this.state.activeGlobalTab === globalTabKeys.explanationTab && (
            <GlobalExplanationTab
              globalBarSettings={this.state.globalBarConfig}
              sortVector={this.state.sortVector}
              dependenceProps={this.state.dependenceProps}
              jointDataset={this.state.jointDataset}
              metadata={this.state.modelMetadata}
              globalImportance={this.state.globalImportance}
              isGlobalDerivedFromLocal={
                this.state.isGlobalImportanceDerivedFromLocal
              }
              onChange={this.setGlobalBarSettings}
              onDependenceChange={this.onDependenceChange}
              cohorts={this.state.cohorts}
              cohortIDs={cohortIDs}
              selectedWeightVector={this.state.selectedWeightVector}
              weightOptions={this.weightVectorOptions}
              weightLabels={this.weightVectorLabels}
              onWeightChange={this.onWeightVectorChange}
              explanationMethod={this.props.explanationMethod}
            />
          )}
          {this.state.activeGlobalTab === globalTabKeys.whatIfTab &&
            this.state.requestPredictions && (
              <WhatIfTab
                jointDataset={this.state.jointDataset}
                metadata={this.state.modelMetadata}
                cohorts={this.state.cohorts}
                onChange={this.onWhatIfConfigChanged}
                chartProps={this.state.whatIfChartConfig}
                invokeModel={this.state.requestPredictions}
                editCohort={this.openCohort}
                selectedWeightVector={this.state.selectedWeightVector}
                weightOptions={this.weightVectorOptions}
                weightLabels={this.weightVectorLabels}
                onWeightChange={this.onWeightVectorChange}
              />
            )}
        </div>
      </div>
    );
  }

  private async validatePredictMethod(): Promise<void> {
    if (
      this.props.requestPredictions &&
      this.props.testData !== undefined &&
      this.props.testData.length > 0
    ) {
      try {
        const abortController = new AbortController();
        const prediction = await this.props.requestPredictions(
          [this.props.testData[0]],
          abortController.signal
        );
        if (prediction !== undefined) {
          this.setState({ requestPredictions: this.props.requestPredictions });
        }
      } catch {
        return;
      }
    }
  }

  private onConfigChanged = (newConfig: IGenericChartProps): void => {
    this.setState({ dataChartConfig: newConfig });
  };

  private onModelConfigChanged = (newConfig: IGenericChartProps): void => {
    this.setState({ modelChartConfig: newConfig });
  };

  private onWhatIfConfigChanged = (newConfig: IGenericChartProps): void => {
    this.setState({ whatIfChartConfig: newConfig });
  };

  private onDependenceChange = (newConfig: IGenericChartProps): void => {
    this.setState({ dependenceProps: newConfig });
  };

  private handleGlobalTabClick = (item?: PivotItem): void => {
    if (item?.props.itemKey) {
      const index: globalTabKeys = globalTabKeys[item.props.itemKey];
      this.setState({ activeGlobalTab: index });
    }
  };

  private setGlobalBarSettings = (settings: IGlobalBarSettings): void => {
    this.setState({ globalBarConfig: settings });
  };

  // private setSortVector(): void {
  //     this.setState({
  //         sortVector: ModelExplanationUtils.getSortIndices(
  //             this.state.cohorts[0].calculateAverageImportance(),
  //         ).reverse(),
  //     });
  // }

  private onCohortChange = (newCohort: Cohort): void => {
    const prevCohorts = [...this.state.cohorts];
    if (this.state.editingCohortIndex) {
      prevCohorts[this.state.editingCohortIndex] = newCohort;
    }
    this.setState({ cohorts: prevCohorts, editingCohortIndex: undefined });
  };

  private onWeightVectorChange = (weightOption: WeightVectorOption): void => {
    this.state.jointDataset.buildLocalFlattenMatrix(weightOption);
    this.state.cohorts.forEach((cohort) => cohort.clearCachedImportances());
    this.setState({ selectedWeightVector: weightOption });
  };

  private deleteCohort = (): void => {
    const prevCohorts = [...this.state.cohorts];
    if (this.state.editingCohortIndex) {
      prevCohorts.splice(this.state.editingCohortIndex, 1);
    }
    this.setState({ cohorts: prevCohorts });
  };

  private clearWarning = (): void => {
    this.setState({ validationWarnings: [] });
  };

  private clearSizeWarning = (): void => {
    this.setState({ showingDatasizeWarning: false });
  };

  private openCohort = (index: number): void => {
    this.setState({ editingCohortIndex: index });
  };

  private cloneAndOpenCohort = (index: number): void => {
    const source = this.state.cohorts[index];
    const cohorts = [...this.state.cohorts];
    cohorts.push(
      new Cohort(
        source.name + localization.CohortBanner.copy,
        this.state.jointDataset,
        [...source.filters]
      )
    );
    this.setState({ cohorts, editingCohortIndex: this.state.cohorts.length });
  };

  private closeCohortEditor = (): void => {
    this.setState({ editingCohortIndex: undefined });
  };
}