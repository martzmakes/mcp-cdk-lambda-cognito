export interface DogFact {
  id: string;
  type: string;
  attributes: {
    body: string;
  };
}

export interface DogFactsResponse {
  data: DogFact[];
  links: {
    next?: string;
    prev?: string;
  };
}