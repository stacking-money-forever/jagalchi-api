export const LEGACY_AI_JOB_CONTRACTS = {
  "coaching": {
    "method": "GET",
    "path": "/ai/learning-coach",
    "request": {
      "additionalProperties": false,
      "properties": {
        "compose_level": {
          "enum": [
            "quick",
            "full"
          ],
          "type": "string"
        },
        "question": {
          "maxLength": 2000,
          "type": "string"
        }
      },
      "required": [
        "question"
      ],
      "type": "object"
    },
    "response": {
      "additionalProperties": false,
      "properties": {
        "answer": {
          "type": "string"
        },
        "behavior_summary": {
          "type": "object"
        },
        "cache_hit": {
          "type": "boolean"
        },
        "created_at": {
          "type": "string"
        },
        "intent": {
          "type": "string"
        },
        "model_version": {
          "type": "string"
        },
        "plan": {
          "items": {
            "type": "string"
          },
          "type": "array"
        },
        "prompt_version": {
          "type": "string"
        },
        "question": {
          "type": "string"
        },
        "retrieval_evidence": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "id": {
                "type": "string"
              },
              "snippet": {
                "type": "string"
              },
              "source": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "snippet",
              "source"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "toolchain": {
          "items": {
            "type": "string"
          },
          "type": "array"
        },
        "user_id": {
          "type": "string"
        }
      },
      "required": [
        "answer",
        "behavior_summary",
        "cache_hit",
        "created_at",
        "intent",
        "model_version",
        "plan",
        "prompt_version",
        "question",
        "retrieval_evidence",
        "toolchain",
        "user_id"
      ],
      "type": "object"
    }
  },
  "node_explanation": {
    "method": "GET",
    "path": "/ai/node-description",
    "request": {
      "additionalProperties": false,
      "properties": {
        "context": {
          "maxLength": 10000,
          "type": "string"
        },
        "node_title": {
          "maxLength": 300,
          "type": "string"
        }
      },
      "required": [
        "node_title"
      ],
      "type": "object"
    },
    "response": {
      "additionalProperties": false,
      "properties": {
        "description": {
          "type": "string"
        },
        "generated_at": {
          "type": "string"
        },
        "node_title": {
          "type": "string"
        }
      },
      "required": [
        "description",
        "generated_at",
        "node_title"
      ],
      "type": "object"
    }
  },
  "resource_recommendation": {
    "method": "GET",
    "path": "/ai/resource-recommendation",
    "request": {
      "additionalProperties": false,
      "properties": {
        "query": {
          "maxLength": 2000,
          "type": "string"
        },
        "recency_days": {
          "maximum": 3650,
          "minimum": 0,
          "type": "integer"
        },
        "top_k": {
          "maximum": 20,
          "minimum": 1,
          "type": "integer"
        }
      },
      "required": [
        "query"
      ],
      "type": "object"
    },
    "response": {
      "additionalProperties": false,
      "properties": {
        "generated_at": {
          "type": "string"
        },
        "items": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "score": {
                "type": "number"
              },
              "source": {
                "type": "string"
              },
              "title": {
                "type": "string"
              },
              "url": {
                "type": "string"
              }
            },
            "required": [
              "score",
              "source",
              "title",
              "url"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "model_version": {
          "type": "string"
        },
        "query": {
          "type": "string"
        },
        "retrieval_evidence": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "id": {
                "type": "string"
              },
              "snippet": {
                "type": "string"
              },
              "source": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "snippet",
              "source"
            ],
            "type": "object"
          },
          "type": "array"
        }
      },
      "required": [
        "generated_at",
        "items",
        "model_version",
        "query",
        "retrieval_evidence"
      ],
      "type": "object"
    }
  },
  "deep_search": {
    "method": "GET",
    "path": "/ai/graph-rag",
    "request": {
      "additionalProperties": false,
      "properties": {
        "query": {
          "maxLength": 2000,
          "type": "string"
        },
        "top_k": {
          "maximum": 20,
          "minimum": 1,
          "type": "integer"
        }
      },
      "required": [
        "query"
      ],
      "type": "object"
    },
    "response": {
      "additionalProperties": false,
      "properties": {
        "graph_snapshot": {
          "additionalProperties": false,
          "properties": {
            "edges": {
              "items": {
                "additionalProperties": false,
                "properties": {
                  "source": {
                    "type": "string"
                  },
                  "target": {
                    "type": "string"
                  },
                  "type": {
                    "nullable": true,
                    "type": "string"
                  }
                },
                "required": [
                  "source",
                  "target"
                ],
                "type": "object"
              },
              "type": "array"
            },
            "nodes": {
              "items": {
                "additionalProperties": false,
                "properties": {
                  "node_id": {
                    "type": "string"
                  },
                  "tags": {
                    "items": {
                      "type": "string"
                    },
                    "type": "array"
                  },
                  "text": {
                    "type": "string"
                  }
                },
                "required": [
                  "node_id",
                  "tags",
                  "text"
                ],
                "type": "object"
              },
              "type": "array"
            }
          },
          "required": [
            "edges",
            "nodes"
          ],
          "type": "object"
        },
        "retrieval_evidence": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "id": {
                "type": "string"
              },
              "snippet": {
                "type": "string"
              },
              "source": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "snippet",
              "source"
            ],
            "type": "object"
          },
          "type": "array"
        }
      },
      "required": [
        "graph_snapshot",
        "retrieval_evidence"
      ],
      "type": "object"
    }
  },
  "feedback": {
    "method": "GET",
    "path": "/ai/record-coach",
    "request": {
      "additionalProperties": false,
      "properties": {
        "compose_level": {
          "enum": [
            "quick",
            "full"
          ],
          "type": "string"
        },
        "node_id": {
          "maxLength": 200,
          "type": "string"
        }
      },
      "required": [
        "node_id"
      ],
      "type": "object"
    },
    "response": {
      "additionalProperties": false,
      "properties": {
        "code_feedback": {
          "type": "object"
        },
        "created_at": {
          "type": "string"
        },
        "followup_questions": {
          "items": {
            "type": "string"
          },
          "type": "array"
        },
        "gaps": {
          "items": {
            "type": "string"
          },
          "type": "array"
        },
        "model_version": {
          "type": "string"
        },
        "next_actions": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "effort": {
                "type": "string"
              },
              "task": {
                "type": "string"
              }
            },
            "required": [
              "effort",
              "task"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "prompt_version": {
          "type": "string"
        },
        "record_id": {
          "type": "string"
        },
        "retrieval_evidence": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "id": {
                "type": "string"
              },
              "snippet": {
                "type": "string"
              },
              "source": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "snippet",
              "source"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "rewrite_suggestions": {
          "additionalProperties": false,
          "properties": {
            "improved_memo": {
              "type": "string"
            },
            "portfolio_bullets": {
              "items": {
                "type": "string"
              },
              "type": "array"
            }
          },
          "required": [
            "improved_memo",
            "portfolio_bullets"
          ],
          "type": "object"
        },
        "scores": {
          "additionalProperties": false,
          "properties": {
            "evidence_level": {
              "type": "integer"
            },
            "quality_score": {
              "type": "integer"
            },
            "reproducibility_score": {
              "type": "integer"
            },
            "specificity_score": {
              "type": "integer"
            },
            "structure_score": {
              "type": "integer"
            }
          },
          "required": [
            "evidence_level",
            "quality_score",
            "reproducibility_score",
            "specificity_score",
            "structure_score"
          ],
          "type": "object"
        },
        "strengths": {
          "items": {
            "type": "string"
          },
          "type": "array"
        }
      },
      "required": [
        "code_feedback",
        "created_at",
        "followup_questions",
        "gaps",
        "model_version",
        "next_actions",
        "prompt_version",
        "record_id",
        "retrieval_evidence",
        "rewrite_suggestions",
        "scores",
        "strengths"
      ],
      "type": "object"
    }
  },
  "roadmap_generation": {
    "method": "GET",
    "path": "/ai/roadmap-generated",
    "request": {
      "additionalProperties": false,
      "properties": {
        "compose_level": {
          "enum": [
            "quick",
            "full"
          ],
          "type": "string"
        },
        "goal": {
          "maxLength": 1000,
          "type": "string"
        },
        "max_nodes": {
          "maximum": 30,
          "minimum": 1,
          "type": "integer"
        },
        "preferred_tags": {
          "type": "string"
        }
      },
      "required": [
        "goal"
      ],
      "type": "object"
    },
    "response": {
      "additionalProperties": false,
      "properties": {
        "created_at": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "edges": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "source": {
                "type": "string"
              },
              "target": {
                "type": "string"
              },
              "type": {
                "nullable": true,
                "type": "string"
              }
            },
            "required": [
              "source",
              "target"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "model_version": {
          "type": "string"
        },
        "nodes": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "node_id": {
                "type": "string"
              },
              "tags": {
                "items": {
                  "type": "string"
                },
                "type": "array"
              },
              "title": {
                "type": "string"
              }
            },
            "required": [
              "node_id",
              "tags",
              "title"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "prompt_version": {
          "type": "string"
        },
        "retrieval_evidence": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "id": {
                "type": "string"
              },
              "snippet": {
                "type": "string"
              },
              "source": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "snippet",
              "source"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "roadmap_id": {
          "type": "string"
        },
        "tags": {
          "items": {
            "type": "string"
          },
          "type": "array"
        },
        "title": {
          "type": "string"
        }
      },
      "required": [
        "created_at",
        "description",
        "edges",
        "model_version",
        "nodes",
        "prompt_version",
        "retrieval_evidence",
        "roadmap_id",
        "tags",
        "title"
      ],
      "type": "object"
    }
  },
  "document_conversion": {
    "method": "POST",
    "path": "/ai/document-roadmap",
    "request": {
      "additionalProperties": false,
      "properties": {
        "document": {
          "maxLength": 100000,
          "type": "string"
        },
        "goal": {
          "maxLength": 1000,
          "type": "string"
        }
      },
      "required": [
        "document"
      ],
      "type": "object"
    },
    "response": {
      "additionalProperties": false,
      "properties": {
        "created_at": {
          "type": "string"
        },
        "document_summary": {
          "type": "string"
        },
        "extracted_keywords": {
          "items": {
            "type": "string"
          },
          "type": "array"
        },
        "model_version": {
          "type": "string"
        },
        "recommended_roadmaps": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "reasons": {
                "items": {
                  "additionalProperties": false,
                  "properties": {
                    "type": {
                      "type": "string"
                    },
                    "value": {
                      "type": "object"
                    }
                  },
                  "required": [
                    "type",
                    "value"
                  ],
                  "type": "object"
                },
                "type": "array"
              },
              "related_roadmap_id": {
                "type": "string"
              },
              "score": {
                "type": "number"
              }
            },
            "required": [
              "reasons",
              "related_roadmap_id",
              "score"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "suggested_topics": {
          "items": {
            "type": "string"
          },
          "type": "array"
        }
      },
      "required": [
        "created_at",
        "document_summary",
        "extracted_keywords",
        "model_version",
        "recommended_roadmaps",
        "suggested_topics"
      ],
      "type": "object"
    }
  }
} as const;

export type LegacyAiJobFeature = keyof typeof LEGACY_AI_JOB_CONTRACTS;
